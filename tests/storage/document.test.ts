import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fc from 'fast-check';
import { Repository, StorageFailure } from '../../src/lib/storage/repository';
import { characterSplitter } from '../../src/lib/analyzer/character';
import { activeAnalyzer } from '../../src/lib/analyzer/active';
import { diskAnalyzer } from '../analyzer/support';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { pasteSource } from '../../src/lib/content/paste';
import { codePointsOf } from '../../src/lib/domain/offsets';
import { freshDatabase } from './support';
import type { Database } from '../../src/lib/storage/db';

// SC-006: reassembling any document's tokens reproduces its source content exactly.
//
// tests/domain/tiling.test.ts already proves the *analyzer* tiles correctly. That is a different
// claim from this one: offsets have to survive being written to SQLite and read back, and a
// storage layer can corrupt them on its own. This is also where a column named `end` — a SQLite
// keyword — would show up, since that survives CREATE TABLE and fails on write.

const EXT_B = '\u{2000B}'; // 𠀋
const ALPHABET = ['我', '看', '书', 'a', '，', '\n', ' ', EXT_B];
// Guaranteed to contain something substantive: whitespace-only input is refused by the content
// source, which is correct behaviour and tested separately. Generating it here would only prove
// that two parts of the system agree about it.
const anyText = fc
	.tuple(
		fc.constantFrom('我', '看', '书', EXT_B),
		fc.array(fc.constantFrom(...ALPHABET), { maxLength: 50 })
	)
	.map(([head, rest]) => head + rest.join(''));

describe('storing and reading documents', () => {
	let db: Database;
	let repository: Repository;

	beforeEach(async () => {
		db = await freshDatabase();
		repository = new Repository(db);
	});

	afterEach(() => db?.close());

	async function save(text: string) {
		const document = await pasteSource.ingest(text);
		const analyzed = await characterSplitter.analyze(document.rawContent);
		const tokens = resolveTokens(document.rawContent, analyzed, characterSplitter);
		return repository.saveDocument(document, tokens, stampOf(characterSplitter));
	}

	it('returns the source content exactly as submitted (FR-002)', async () => {
		const text = '我看书。\n  第二行 with Latin.';
		const stored = repository.getDocument(await save(text));
		expect(stored.rawContent).toBe(text);
	});

	it('reassembles any document from its stored tokens (SC-006)', async () => {
		await fc.assert(
			fc.asyncProperty(anyText, async (text) => {
				// A fresh database per run: documents accumulate otherwise, and the lexeme table
				// would be doing different work on the hundredth case than on the first.
				const scratch = await freshDatabase();
				try {
					const scoped = new Repository(scratch);
					const document = await pasteSource.ingest(text);
					const analyzed = await characterSplitter.analyze(document.rawContent);
					const tokens = resolveTokens(document.rawContent, analyzed, characterSplitter);
					const stored = scoped.getDocument(
						scoped.saveDocument(document, tokens, stampOf(characterSplitter))
					);

					const characters = codePointsOf(stored.rawContent);
					const rebuilt = stored.tokens
						.map((t) => characters.slice(t.start, t.end).join(''))
						.join('');
					expect(rebuilt).toBe(stored.rawContent);
				} finally {
					scratch.close();
				}
			}),
			{ numRuns: 25 }
		);
	});

	it('keeps tokens in order, with nothing added or dropped', async () => {
		const text = '我看书';
		const stored = repository.getDocument(await save(text));
		expect(stored.tokens.map((t) => t.start)).toEqual([0, 1, 2]);
		expect(stored.tokens).toHaveLength(3);
	});

	it('records which analyzer produced the tokens (FR-003)', async () => {
		const stored = repository.getDocument(await save('我看书'));
		expect(stored.analyzer).toBe('character-splitter');
		expect(stored.analyzerVersion).toBe('1');
		expect(stored.contentType).toBe('text/plain');
	});

	it('gives every word token a lexeme, and no non-word token one', async () => {
		const stored = repository.getDocument(await save('我，书'));
		for (const token of stored.tokens) {
			if (token.isWord) expect(token.lexemeId).toBeTypeOf('number');
			else expect(token.lexemeId).toBeUndefined();
		}
	});

	it('shares one lexeme across occurrences and across documents (FR-007)', async () => {
		const first = repository.getDocument(await save('看书'));
		const second = repository.getDocument(await save('看书看'));

		const lexemeOf = (
			text: string,
			doc: { rawContent: string; tokens: { start: number; lexemeId?: number }[] }
		) => doc.tokens.find((t) => codePointsOf(doc.rawContent)[t.start] === text)?.lexemeId;

		// The same character in two different documents resolves to the same word.
		expect(lexemeOf('看', first)).toBe(lexemeOf('看', second));
		expect(lexemeOf('看', first)).toBeTypeOf('number');
	});

	it('lists saved documents', async () => {
		await save('第一');
		await save('第二');
		const listed = repository.listDocuments();
		expect(listed).toHaveLength(2);
		expect(listed.map((d) => d.title).sort()).toEqual(['第一', '第二']);
	});

	it('refuses tokens that do not tile the document (FR-005)', async () => {
		const document = await pasteSource.ingest('我看书');
		// Stops two characters short of the end.
		const broken = [{ start: 0, end: 1, isWord: true, lexemeKey: '我' }];
		expect(() => repository.saveDocument(document, broken, stampOf(characterSplitter))).toThrow(
			StorageFailure
		);
	});

	it('reports a missing document rather than returning nothing', () => {
		expect(() => repository.getDocument(9999)).toThrow(StorageFailure);
	});

	// --- Importing under the real analyzer (slice 2, US1) --------------------------------------
	//
	// What US1 promises is that marking a word records one judgment about that word, rather than
	// several about its characters. That is a claim about identity, not about segmentation, so it
	// can be asserted exactly without encoding any analyzer's opinion of where words are.

	// The shipped analyzer fetches its word list over HTTP, which no unit test can serve. This is
	// the same implementation over the same committed data, loaded from disk instead.
	async function saveWithActiveAnalyzer(text: string) {
		const document = await pasteSource.ingest(text);
		const analyzed = await diskAnalyzer.analyze(document.rawContent);
		const tokens = resolveTokens(document.rawContent, analyzed, diskAnalyzer);
		return repository.saveDocument(document, tokens, stampOf(diskAnalyzer));
	}

	it('exercises the analyzer that actually ships', () => {
		// Without this, the tests below could drift into proving something about an analyzer the
		// reader never uses.
		expect(diskAnalyzer.name).toBe(activeAnalyzer.name);
		expect(diskAnalyzer.version).toBe(activeAnalyzer.version);
	});

	it('stamps documents with the active analyzer and its fingerprint (FR-010)', async () => {
		const stored = repository.getDocument(await saveWithActiveAnalyzer('我在中国学习中文。'));
		expect(stored.analyzer).toBe(activeAnalyzer.name);
		expect(stored.analyzerVersion).toBe(activeAnalyzer.version);
		// A hand-written version would be a lie for a host-provided segmenter (ADR-0011), so the
		// stamp must not be the placeholder's constant.
		expect(stored.analyzerVersion).not.toBe('1');
	});

	it('binds every occurrence of the same word to one lexeme', async () => {
		// 中文 appears twice. Whatever the analyzer decides a word is, two occurrences of the same
		// surface must share an identity, or a mark made on one would not apply to the other.
		const stored = repository.getDocument(await saveWithActiveAnalyzer('中文很难。我学中文。'));
		const characters = codePointsOf(stored.rawContent);
		const identities = new Map<string, Set<number>>();

		for (const token of stored.tokens) {
			if (token.lexemeId === undefined) continue;
			const surface = characters.slice(token.start, token.end).join('');
			if (!identities.has(surface)) identities.set(surface, new Set());
			identities.get(surface)!.add(token.lexemeId);
		}

		for (const [surface, ids] of identities) {
			expect(ids.size, `"${surface}" resolved to more than one lexeme`).toBe(1);
		}
	});

	it('records one judgment for a word, not one per character', async () => {
		const id = await saveWithActiveAnalyzer('我在中国学习中文。');
		const stored = repository.getDocument(id);

		// Pick the longest word the analyzer found, whatever it turned out to be. Naming an
		// expected word here would encode one ICU build's judgment (Principle II).
		const longest = stored.tokens
			.filter((token) => token.lexemeId !== undefined)
			.sort((a, b) => b.end - b.start - (a.end - a.start))[0];
		expect(longest.end - longest.start).toBeGreaterThan(1);

		repository.assertState(longest.lexemeId!, 'known');

		const history = repository.readHistory();
		expect(history).toHaveLength(1);
		expect(history[0].lexemeId).toBe(longest.lexemeId);

		const states = repository.getStates([longest.lexemeId!]);
		expect(states.get(longest.lexemeId!)?.state).toBe('known');
	});
});
