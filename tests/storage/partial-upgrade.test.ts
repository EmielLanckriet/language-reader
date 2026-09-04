import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { Repository, type StoredDocument } from '../../src/lib/storage/repository';
import { characterSplitter } from '../../src/lib/analyzer/character';
import { CHINESE_UNIT_DELIMITERS } from '../../src/lib/analyzer/delimiters';
import { splitIntoUnits } from '../../src/lib/analyzer/units';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { pasteSource } from '../../src/lib/content/paste';
import { codePointsOf } from '../../src/lib/domain/offsets';
import { tiles } from '../../src/lib/domain/tiling';
import { freshDatabase } from './support';
import type { Database } from '../../src/lib/storage/db';
import type { Analyzer, AnalyzedToken } from '../../src/lib/analyzer/types';

// A document may be part-way through an upgrade to a better analyzer (ADR-0016), and these are the
// properties that make the boundary it records trustworthy rather than merely plausible.
//
// The division of assertions follows the constitution's division of the data. Tokens are
// **derived**, so nothing here says what a segmentation should be — the properties are that
// batching cannot change the answer, that the document tiles at every intermediate state, and that
// the recorded boundary describes the tokens that are actually stored. Marks are **earned**, so
// they are asserted exactly: by count, and by content.
//
// The analyzers are fakes on purpose. The real upgrade analyzer is a 98 MB model that cannot run in
// a unit test, and the mechanism must hold for any pair of analyzers that respect the same
// segmentation units, not for one particular segmenter.

/**
 * Pairs characters inside each segmentation unit.
 *
 * Chosen for one reason: it produces multi-character words, so a document upgraded from
 * `characterSplitter` to this one changes visibly and in a way a property can check, and it
 * respects unit delimiters, which is the condition ADR-0016's boundary rests on.
 */
const pairwise: Analyzer = {
	name: 'pairwise-test',
	version: '1',
	language: 'zh',
	unitDelimiters: CHINESE_UNIT_DELIMITERS,

	async analyze(text: string): Promise<AnalyzedToken[]> {
		const tokens: AnalyzedToken[] = [];

		for (const unit of splitIntoUnits(text, CHINESE_UNIT_DELIMITERS)) {
			const characters = codePointsOf(unit.text);
			let at = 0;
			while (at < characters.length) {
				if (CHINESE_UNIT_DELIMITERS.has(characters[at])) {
					tokens.push({ start: unit.start + at, end: unit.start + at + 1, isWord: false });
					at += 1;
					continue;
				}
				const end = Math.min(at + 2, characters.length);
				tokens.push({ start: unit.start + at, end: unit.start + end, isWord: true });
				at = end;
			}
		}

		return tokens;
	},

	lexemeKey: (surface) => surface
};

const TEXT =
	'我在中国学习中文。他骑自行车去上班。今天天气很好！你是哪国人？' +
	'她昨天买了一本新书。我们一起去看电影吧！明天见。';

/** Where segmentation units end, which is where a batch may stop (ADR-0013, ADR-0016). */
function unitBoundaries(text: string, analyzer: Analyzer): number[] {
	const boundaries: number[] = [];
	for (const unit of splitIntoUnits(text, analyzer.unitDelimiters)) {
		boundaries.push(unit.start + codePointsOf(unit.text).length);
	}
	return boundaries;
}

/**
 * One batch, produced by analysing **only** its own stretch of the document.
 *
 * Deliberately not by analysing the whole document and slicing the result: that would make the
 * equivalence property below true by construction and prove nothing. Analysing the span alone is
 * what the driver does on the phone, and whether it gives the same answer is exactly the question.
 */
async function batchOf(text: string, analyzer: Analyzer, from: number, through: number) {
	const characters = codePointsOf(text);
	const span = characters.slice(from, through).join('');
	const analyzed = (await analyzer.analyze(span)).map((token) => ({
		...token,
		start: token.start + from,
		end: token.end + from
	}));
	return { from, through, tokens: resolveTokens(text, analyzed, analyzer) };
}

function shapeOf(document: StoredDocument) {
	return document.tokens.map((token) => ({
		start: token.start,
		end: token.end,
		isWord: token.isWord
	}));
}

describe('upgrading a document one batch at a time', () => {
	let db: Database;
	let repository: Repository;

	beforeEach(async () => {
		db = await freshDatabase();
		repository = new Repository(db);
	});

	afterEach(() => db?.close());

	async function saveUnder(analyzer: Analyzer, text = TEXT) {
		const document = await pasteSource.ingest(text);
		const analyzed = await analyzer.analyze(document.rawContent);
		const tokens = resolveTokens(document.rawContent, analyzed, analyzer);
		return repository.saveDocument(document, tokens, stampOf(analyzer));
	}

	/** Upgrade to `analyzer`, stopping at each of `boundaries` in turn. */
	async function upgradeThrough(id: number, analyzer: Analyzer, boundaries: number[]) {
		let from = 0;
		for (const through of boundaries) {
			const document = repository.getDocument(id);
			repository.advanceUpgrade(
				id,
				await batchOf(document.rawContent, analyzer, from, through),
				stampOf(analyzer)
			);
			from = through;
		}
	}

	it('reaches the same tokens however it is batched', async () => {
		const boundaries = unitBoundaries(TEXT, pairwise);
		const interior = boundaries.slice(0, -1);
		const end = boundaries[boundaries.length - 1];

		// What one uninterrupted pass produces, which is what every batching must match.
		const whole = await saveUnder(characterSplitter);
		const analyzed = await pairwise.analyze(TEXT);
		repository.replaceTokens(whole, resolveTokens(TEXT, analyzed, pairwise), stampOf(pairwise));
		const expected = shapeOf(repository.getDocument(whole));

		await fc.assert(
			fc.asyncProperty(fc.subarray(interior), async (stops) => {
				const id = await saveUnder(characterSplitter);
				await upgradeThrough(id, pairwise, [...stops, end]);

				const upgraded = repository.getDocument(id);
				expect(shapeOf(upgraded)).toEqual(expected);
				expect(upgraded.analyzer).toBe(pairwise.name);
				expect(upgraded.analyzerVersion).toBe(pairwise.version);
				// A document that has arrived must not still say it is on the way.
				expect(upgraded.upgrade).toBeUndefined();
			}),
			{ numRuns: 25 }
		);
	});

	it('tiles the document at every intermediate state, and says how far it has reached', async () => {
		const boundaries = unitBoundaries(TEXT, pairwise);

		await fc.assert(
			fc.asyncProperty(fc.subarray(boundaries.slice(0, -1), { minLength: 1 }), async (stops) => {
				const id = await saveUnder(characterSplitter);

				let from = 0;
				for (const through of stops) {
					const document = repository.getDocument(id);
					repository.advanceUpgrade(
						id,
						await batchOf(document.rawContent, pairwise, from, through),
						stampOf(pairwise)
					);
					from = through;

					const mid = repository.getDocument(id);
					expect(tiles(mid.tokens, mid.rawContent)).toBe(true);
					expect(mid.upgrade).toEqual({
						analyzer: pairwise.name,
						version: pairwise.version,
						through
					});
					// Still stamped by what produced the tokens after the boundary.
					expect(mid.analyzer).toBe(characterSplitter.name);
				}
			}),
			{ numRuns: 20 }
		);
	});

	it('records a boundary that describes the tokens actually stored', async () => {
		const boundaries = unitBoundaries(TEXT, pairwise);
		const through = boundaries[1];

		const id = await saveUnder(characterSplitter);
		await upgradeThrough(id, pairwise, [through]);
		const document = repository.getDocument(id);

		// The invariant, checked directly rather than through a proxy: each side of the boundary
		// holds exactly what its own analyzer produces for that side.
		const before = await batchOf(TEXT, pairwise, 0, through);
		const after = await batchOf(TEXT, characterSplitter, through, codePointsOf(TEXT).length);

		expect(document.tokens.filter((token) => token.start < through)).toMatchObject(
			before.tokens.map(({ start, end, isWord }) => ({ start, end, isWord }))
		);
		expect(document.tokens.filter((token) => token.start >= through)).toMatchObject(
			after.tokens.map(({ start, end, isWord }) => ({ start, end, isWord }))
		);
	});

	it('keeps every mark the reader earned, batch after batch', async () => {
		const id = await saveUnder(characterSplitter);
		const before = repository.getDocument(id);

		// Mark three words, at the start, the middle and the end, so an upgrade that damages any
		// part of the document is caught rather than only one that damages the part it starts on.
		const words = before.tokens.filter((token) => token.lexemeId !== undefined);
		const marked = [words[0], words[Math.floor(words.length / 2)], words[words.length - 1]];
		for (const token of marked) {
			repository.assertState(token.lexemeId!, 'known', {
				documentId: id,
				fromOffset: token.start,
				toOffset: token.end
			});
		}
		const historyBefore = repository.readHistory();

		await upgradeThrough(id, pairwise, unitBoundaries(TEXT, pairwise));

		// Earned data, asserted exactly. Nothing was added, removed, altered or reattached.
		expect(repository.readHistory()).toEqual(historyBefore);

		const states = repository.getStates(marked.map((token) => token.lexemeId!));
		expect(states.size).toBe(3);
		for (const token of marked) {
			expect(states.get(token.lexemeId!)?.state).toBe('known');
		}
	});

	it('refuses a batch that does not start where the upgrade left off', async () => {
		const boundaries = unitBoundaries(TEXT, pairwise);
		const id = await saveUnder(characterSplitter);
		await upgradeThrough(id, pairwise, [boundaries[0]]);

		// A gap: everything between the recorded boundary and this batch would be left claimed for
		// an analyzer that never saw it.
		const skipping = await batchOf(TEXT, pairwise, boundaries[1], boundaries[2]);
		expect(() => repository.advanceUpgrade(id, skipping, stampOf(pairwise))).toThrow(
			/reached \d+, but this batch starts at/
		);

		// And the document is untouched by the attempt.
		expect(repository.getDocument(id).upgrade?.through).toBe(boundaries[0]);
	});

	it('starts a superseded upgrade again, and will not leave any of it behind', async () => {
		const boundaries = unitBoundaries(TEXT, pairwise);
		const later: Analyzer = { ...pairwise, version: '2' };

		const id = await saveUnder(characterSplitter);
		await upgradeThrough(id, pairwise, [boundaries[2]]);

		// Resuming a different analyzer's progress is not resuming: it is claiming its tokens.
		const resuming = await batchOf(TEXT, later, boundaries[2], boundaries[3]);
		expect(() => repository.advanceUpgrade(id, resuming, stampOf(later))).toThrow(
			/must start at the beginning/
		);

		// Nor may the new upgrade stop short of what the old one wrote, which would leave the
		// difference stranded on the wrong side of the boundary.
		const tooShort = await batchOf(TEXT, later, 0, boundaries[1]);
		expect(() => repository.advanceUpgrade(id, tooShort, stampOf(later))).toThrow(
			/must cover at least as much/
		);

		// Covering it is allowed, and takes over the record.
		const covering = await batchOf(TEXT, later, 0, boundaries[2]);
		repository.advanceUpgrade(id, covering, stampOf(later));
		expect(repository.getDocument(id).upgrade).toEqual({
			analyzer: later.name,
			version: '2',
			through: boundaries[2]
		});
	});

	it('forgets a partial upgrade when every token is replaced at once', async () => {
		const boundaries = unitBoundaries(TEXT, pairwise);
		const id = await saveUnder(characterSplitter);
		await upgradeThrough(id, pairwise, [boundaries[1]]);

		const analyzed = await characterSplitter.analyze(TEXT);
		repository.replaceTokens(
			id,
			resolveTokens(TEXT, analyzed, characterSplitter),
			stampOf(characterSplitter)
		);

		// The boundary described tokens that no longer exist, so it must not survive them.
		expect(repository.getDocument(id).upgrade).toBeUndefined();
	});

	it('refuses to upgrade a document to the analyzer that already stamped it', async () => {
		const id = await saveUnder(pairwise);
		const batch = await batchOf(TEXT, pairwise, 0, unitBoundaries(TEXT, pairwise)[0]);
		expect(() => repository.advanceUpgrade(id, batch, stampOf(pairwise))).toThrow(
			/nothing to upgrade/
		);
	});
});
