import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { characterSplitter } from '../../src/lib/analyzer/character';
import { chineseSegmenter } from '../../src/lib/analyzer/chinese';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { pasteSource } from '../../src/lib/content/paste';
import { codePointsOf } from '../../src/lib/domain/offsets';
import {
	isStale,
	looksUnsegmented,
	needsImmediateRederivation
} from '../../src/lib/storage/rederive';
import { freshDatabase } from './support';
import type { Database } from '../../src/lib/storage/db';
import type { Analyzer } from '../../src/lib/analyzer/types';

// Slice 0 wrote into its data model, its contract and an ADR that swapping an analyzer is "a
// recompute against retained source, not a migration". Nothing ever executed that path. This is it.
//
// The assertions divide the way the constitution divides the data. Tokens are **derived**: they are
// asserted on properties, never against an expected segmentation. Marks are **earned**: they are
// asserted exactly, by count and by content, because nothing can reconstruct them.

describe('re-deriving a document under a new analyzer', () => {
	let db: Database;
	let repository: Repository;

	beforeEach(async () => {
		db = await freshDatabase();
		repository = new Repository(db);
	});

	afterEach(() => db?.close());

	async function saveUnder(analyzer: Analyzer, text: string) {
		const document = await pasteSource.ingest(text);
		const analyzed = await analyzer.analyze(document.rawContent);
		const tokens = resolveTokens(document.rawContent, analyzed, analyzer);
		return repository.saveDocument(document, tokens, stampOf(analyzer));
	}

	/** What the application does on the main thread, where the analyzer lives. */
	async function rederive(id: number, analyzer: Analyzer) {
		const stored = repository.getDocument(id);
		const analyzed = await analyzer.analyze(stored.rawContent);
		const tokens = resolveTokens(stored.rawContent, analyzed, analyzer);
		repository.replaceTokens(id, tokens, stampOf(analyzer));
	}

	const TEXT = '我在中国学习中文。他骑自行车去上班。';

	it('leaves the retained source byte-identical (FR-014)', async () => {
		const id = await saveUnder(characterSplitter, TEXT);
		const before = repository.getDocument(id).rawContent;

		await rederive(id, chineseSegmenter);

		expect(repository.getDocument(id).rawContent).toBe(before);
		expect(repository.getDocument(id).rawContent).toBe(TEXT);
	});

	it('leaves every recorded judgment exactly as it was (FR-023, FR-024)', async () => {
		const id = await saveUnder(characterSplitter, TEXT);
		const stored = repository.getDocument(id);

		// Mark three characters, as the reader would have under the placeholder.
		const marked = stored.tokens.filter((t) => t.lexemeId !== undefined).slice(0, 3);
		for (const token of marked) repository.assertState(token.lexemeId!, 'known');

		const historyBefore = repository.readHistory();
		const statesBefore = repository.getStates(marked.map((t) => t.lexemeId!));
		expect(historyBefore).toHaveLength(3);

		await rederive(id, chineseSegmenter);

		// Earned data: asserted exactly, not approximately. Same count, same content, same order.
		expect(repository.readHistory()).toEqual(historyBefore);
		expect(repository.getStates(marked.map((t) => t.lexemeId!))).toEqual(statesBefore);
	});

	it('keeps a mark reachable when its form is no longer a standalone word (FR-025)', async () => {
		const id = await saveUnder(characterSplitter, TEXT);
		const stored = repository.getDocument(id);
		const characters = codePointsOf(stored.rawContent);

		// A single character that the real analyzer will most likely absorb into a longer word.
		const single = stored.tokens.find(
			(t) => t.lexemeId !== undefined && characters[t.start] === '国'
		)!;
		repository.assertState(single.lexemeId!, 'known');

		await rederive(id, chineseSegmenter);

		// The mark is retained and retrievable under the same identity. It is NOT asserted to be
		// visible anywhere: nothing in the application displays vocabulary yet, which is why FR-025
		// is scoped to storage.
		const states = repository.getStates([single.lexemeId!]);
		expect(states.get(single.lexemeId!)?.state).toBe('known');
		expect(repository.readHistory()).toHaveLength(1);
	});

	it('stamps the document with the analyzer that actually produced its tokens (FR-020)', async () => {
		const id = await saveUnder(characterSplitter, TEXT);
		expect(repository.getDocument(id).analyzer).toBe('character-splitter');

		await rederive(id, chineseSegmenter);

		const after = repository.getDocument(id);
		expect(after.analyzer).toBe(chineseSegmenter.name);
		expect(after.analyzerVersion).toBe(chineseSegmenter.version);
		// And the tokens really are the new analyzer's: fewer of them, because words group
		// characters. A property, not an expected segmentation.
		expect(after.tokens.length).toBeLessThan(codePointsOf(TEXT).length);
	});

	it('still tiles the document exactly afterwards (FR-006)', async () => {
		const id = await saveUnder(characterSplitter, TEXT);
		await rederive(id, chineseSegmenter);

		const after = repository.getDocument(id);
		const characters = codePointsOf(after.rawContent);
		const rebuilt = after.tokens.map((t) => characters.slice(t.start, t.end).join('')).join('');
		expect(rebuilt).toBe(after.rawContent);
	});

	it('is idempotent: re-deriving a current document changes nothing (FR-021)', async () => {
		const id = await saveUnder(chineseSegmenter, TEXT);
		const before = repository.getDocument(id);

		await rederive(id, chineseSegmenter);

		expect(repository.getDocument(id)).toEqual(before);
	});

	it('leaves the document untouched when the new tokens do not tile it (FR-020)', async () => {
		const id = await saveUnder(characterSplitter, TEXT);
		const before = repository.getDocument(id);

		// A broken analyzer: tokens that stop short of the end. The write must fail as a whole
		// rather than leaving one analyzer's tokens under another analyzer's stamp.
		const truncated = resolveTokens(
			before.rawContent,
			(await characterSplitter.analyze(before.rawContent)).slice(0, 3),
			characterSplitter
		);
		expect(() =>
			repository.replaceTokens(id, truncated, { name: 'broken', version: 'x' })
		).toThrow();

		expect(repository.getDocument(id)).toEqual(before);
	});

	it('finds exactly the documents whose stamp differs from the active analyzer', async () => {
		const stale = await saveUnder(characterSplitter, TEXT);
		const current = await saveUnder(chineseSegmenter, '另一个文件。');

		const found = repository.staleDocumentIds(chineseSegmenter.name, chineseSegmenter.version);
		expect(found).toEqual([stale]);

		await rederive(stale, chineseSegmenter);
		expect(repository.staleDocumentIds(chineseSegmenter.name, chineseSegmenter.version)).toEqual(
			[]
		);
		expect(repository.getDocument(current).analyzer).toBe(chineseSegmenter.name);
	});

	it('produces the same tokens whichever path re-derives it (FR-017)', async () => {
		// Both paths call one function, so this ought to be trivially true. It is asserted anyway:
		// the property that matters is not "the code is shared today" but "the two paths agree",
		// and this is the test that fails if someone later gives the sweep its own shortcut.
		const viaOpen = await saveUnder(characterSplitter, TEXT);
		const viaSweep = await saveUnder(characterSplitter, TEXT);

		await rederive(viaOpen, chineseSegmenter);

		// The sweep's route: find what is stale, then re-derive each one.
		const staleIds = repository.staleDocumentIds(chineseSegmenter.name, chineseSegmenter.version);
		expect(staleIds).toContain(viaSweep);
		for (const id of staleIds) await rederive(id, chineseSegmenter);

		const opened = repository.getDocument(viaOpen);
		const swept = repository.getDocument(viaSweep);
		expect(swept.tokens).toEqual(opened.tokens);
		expect(swept.analyzerVersion).toBe(opened.analyzerVersion);
	});
});

// Slice 2 shipped a segmenter that costs ~4 s per 1,000 characters (research.md R18), so
// re-deriving on open — which slice 1 did unconditionally — turned a 5,000-character document into
// a thirty-second wait and failed SC-004. Documents are now imported with the fast fallback and
// upgraded by the background sweep, which means a document being *out of date* is the normal case
// rather than an exception, and opening one must not pay for the upgrade.
//
// What may still not be shown is placeholder segmentation (FR-015). So the question opening a
// document asks is no longer "is this stale" but "are these tokens too poor to show", and that is
// what these tests are about. It is a property of the stored tokens, deliberately not a list of
// analyzer names: a name cannot tell you what a device actually produced, which is the whole
// lesson of research.md R11, where `Intl.Segmenter` returned one token per character on the
// reader's phone and the name said nothing.

describe('deciding whether an out-of-date document must be re-derived before it is shown', () => {
	let db: Database;
	let repository: Repository;

	beforeEach(async () => {
		db = await freshDatabase();
		repository = new Repository(db);
	});

	afterEach(() => db?.close());

	async function stored(analyzer: Analyzer, text: string) {
		const document = await pasteSource.ingest(text);
		const analyzed = await analyzer.analyze(document.rawContent);
		const tokens = resolveTokens(document.rawContent, analyzed, analyzer);
		const id = repository.saveDocument(document, tokens, stampOf(analyzer));
		return repository.getDocument(id);
	}

	const prose = '朋友很好，我在中国学习中文。';

	it('says yes for slice 0 placeholder tokens: every word one character', async () => {
		const document = await stored(characterSplitter, prose);
		expect(looksUnsegmented(document)).toBe(true);
	});

	it('says no for a real segmenter, which finds words longer than a character', async () => {
		const document = await stored(chineseSegmenter, prose);
		expect(looksUnsegmented(document)).toBe(false);
	});

	it('says no when there is no Han text to segment, whatever the analyzer', async () => {
		// A document of digits and Latin has no multi-character *word* under any analyzer, and
		// re-deriving it would be a thirty-second answer to a question nobody asked.
		const document = await stored(characterSplitter, 'Python 3.14 / SQLite 3.45');
		expect(looksUnsegmented(document)).toBe(false);
	});

	it('only ever asks the question of a document that is out of date', async () => {
		// A document already stamped by the analyzer in force is not re-derived on any grounds:
		// `rederiveDocument` is idempotent, and asking twice would be a wasted pass.
		const document = await stored(characterSplitter, prose);
		expect(needsImmediateRederivation(document, characterSplitter)).toBe(false);
		expect(looksUnsegmented(document)).toBe(true);
	});

	it('re-derives placeholder tokens on open, and merely stamps real words as out of date', async () => {
		const placeholder = await stored(characterSplitter, prose);
		const real = await stored(chineseSegmenter, prose);

		// Both are stale under a third analyzer; only one is too poor to show.
		const other: Analyzer = { ...chineseSegmenter, version: 'something-else' };
		expect(isStale(placeholder, other)).toBe(true);
		expect(isStale(real, other)).toBe(true);

		expect(needsImmediateRederivation(placeholder, other)).toBe(true);
		expect(needsImmediateRederivation(real, other)).toBe(false);
	});
});
