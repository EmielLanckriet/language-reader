import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { characterSplitter } from '../../src/lib/analyzer/character';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { pasteSource } from '../../src/lib/content/paste';
import { queryRows, type Database } from '../../src/lib/storage/db';
import { freshDatabase } from './support';

// SC-004: marking 100 words in one sitting results in exactly 100 states and exactly 100 history
// entries, with no losses and no duplicates.
//
// It is a counting test, which sounds trivial, and it is the shape of test that catches the two
// mistakes this write path is most likely to make: an upsert that inserts a second state row
// instead of replacing one, and an append that silently drops an entry when the projection write
// fails. Both leave the app looking correct.

function count(db: Database, table: string): number {
	return Number(queryRows(db, `SELECT COUNT(*) AS n FROM ${table}`)[0].n);
}

describe('marking many words', () => {
	let db: Database;
	let repository: Repository;
	let wordLexemes: number[];

	beforeEach(async () => {
		db = await freshDatabase();
		repository = new Repository(db);

		// 100 distinct characters, so 100 distinct words. Generated from a contiguous block of
		// CJK Unified Ideographs rather than typed out, because what matters is the count.
		const text = Array.from({ length: 100 }, (_, i) => String.fromCodePoint(0x4e00 + i)).join('');
		const document = await pasteSource.ingest(text);
		const analyzed = await characterSplitter.analyze(document.rawContent);
		const tokens = resolveTokens(document.rawContent, analyzed, characterSplitter);
		const documentId = repository.saveDocument(document, tokens, stampOf(characterSplitter));

		wordLexemes = repository
			.getDocument(documentId)
			.tokens.filter((t) => t.isWord)
			.map((t) => t.lexemeId!);
	});

	afterEach(() => db?.close());

	it('has 100 distinct words to mark', () => {
		expect(new Set(wordLexemes).size).toBe(100);
	});

	it('produces exactly 100 states and exactly 100 history entries (SC-004)', () => {
		for (const lexemeId of wordLexemes) repository.assertState(lexemeId, 'known');

		expect(count(db, 'word_state')).toBe(100);
		expect(count(db, 'status_event')).toBe(100);
	});

	it('adds history without adding a state row when a word is re-marked (FR-006b)', () => {
		const lexemeId = wordLexemes[0];
		repository.assertState(lexemeId, 'unknown');
		repository.assertState(lexemeId, 'learning');
		repository.assertState(lexemeId, 'known');

		// One word, one state row, three entries in its history. The earlier states remain
		// recoverable, which is acceptance scenario 4 of User Story 2.
		expect(count(db, 'word_state')).toBe(1);
		expect(count(db, 'status_event')).toBe(3);
		expect(repository.getStates([lexemeId]).get(lexemeId)?.state).toBe('known');
	});

	it('leaves unmarked words with no row at all (FR-006b)', () => {
		repository.assertState(wordLexemes[0], 'known');

		expect(count(db, 'word_state')).toBe(1);
		// The other 99 words were displayed and never touched. Absence means never judged, which
		// is distinct from any state the reader could have chosen.
		expect(repository.getStates(wordLexemes).size).toBe(1);
	});

	it('rebuilds the identical projection from the history (FR-011, SC-007)', () => {
		for (const [index, lexemeId] of wordLexemes.entries()) {
			repository.assertState(lexemeId, index % 2 === 0 ? 'known' : 'learning');
		}
		const before = queryRows(db, 'SELECT * FROM word_state ORDER BY lexeme_id');

		repository.rebuildProjection();

		const after = queryRows(db, 'SELECT * FROM word_state ORDER BY lexeme_id');
		expect(after).toEqual(before);
		expect(count(db, 'status_event')).toBe(100);
	});

	it('reads the history back in order', () => {
		for (const lexemeId of wordLexemes.slice(0, 5)) repository.assertState(lexemeId, 'known');

		const history = repository.readHistory();
		expect(history).toHaveLength(5);
		expect(history.map((e) => e.deviceSeq)).toEqual(
			[...history.map((e) => e.deviceSeq)].sort((a, b) => a - b)
		);
	});
});
