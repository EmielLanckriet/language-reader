import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { characterSplitter } from '../../src/lib/analyzer/character';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { pasteSource } from '../../src/lib/content/paste';
import { queryRows, type Database } from '../../src/lib/storage/db';
import { freshDatabase } from './support';

// FR-012 and FR-013, and the finding that prompted them being written rather than merely declared.
//
// The migration test proves these columns exist. That is not the same claim as this one: a column
// that exists and is never written is a hedge in name only, and the failure is silent — the schema
// looks right, the tests pass, and slice 1 inherits a write path that skips it. What is checked
// here is that a *real* write through assertState populates them on both tables.

describe('provenance and owner on a real write', () => {
	let db: Database;
	let repository: Repository;
	let lexemeId: number;

	beforeEach(async () => {
		db = await freshDatabase();
		repository = new Repository(db);
		const document = await pasteSource.ingest('看书');
		const analyzed = await characterSplitter.analyze(document.rawContent);
		const tokens = resolveTokens(document.rawContent, analyzed, characterSplitter);
		const documentId = repository.saveDocument(document, tokens, stampOf(characterSplitter));
		lexemeId = repository.getDocument(documentId).tokens.find((t) => t.isWord)!.lexemeId!;
	});

	afterEach(() => db?.close());

	it('populates provenance and user_id on word_state (FR-012, FR-013)', () => {
		repository.assertState(lexemeId, 'learning');

		const rows = queryRows(db, 'SELECT * FROM word_state WHERE lexeme_id = ?', [lexemeId]);
		expect(rows).toHaveLength(1);
		expect(rows[0].provenance).not.toBeNull();
		expect(rows[0].provenance).toBe('manual');
		expect(rows[0].user_id).not.toBeNull();
	});

	it('populates provenance and user_id on status_event too', () => {
		repository.assertState(lexemeId, 'learning');

		const rows = queryRows(db, 'SELECT * FROM status_event WHERE lexeme_id = ?', [lexemeId]);
		expect(rows).toHaveLength(1);
		expect(rows[0].provenance).toBe('manual');
		expect(rows[0].user_id).not.toBeNull();
	});

	it('records which device made the judgment, and where in its sequence (FR-010c)', () => {
		repository.assertState(lexemeId, 'known');

		const rows = queryRows(db, 'SELECT device_id, device_seq FROM status_event');
		expect(rows[0].device_id).not.toBeNull();
		expect(Number(rows[0].device_seq)).toBeGreaterThan(0);
	});

	it('advances the device counter, so no two entries share a position', () => {
		repository.assertState(lexemeId, 'unknown');
		repository.assertState(lexemeId, 'learning');
		repository.assertState(lexemeId, 'known');

		const seqs = queryRows(db, 'SELECT device_seq FROM status_event ORDER BY device_seq').map((r) =>
			Number(r.device_seq)
		);
		expect(new Set(seqs).size).toBe(3);
		expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
	});

	it('refuses to write a state with no provenance at all', () => {
		// The schema is the last line of defence, not the only one: provenance is NOT NULL without
		// a default precisely so that a caller which forgot it fails loudly rather than storing a
		// plausible-looking blank.
		expect(() =>
			db.exec("INSERT INTO word_state (lexeme_id, state) VALUES (999, 'known')")
		).toThrow();
	});

	it('keeps the occurrence when the reader marked a word in a document', () => {
		repository.assertState(lexemeId, 'known', { documentId: 1, fromOffset: 0, toOffset: 1 });

		const rows = queryRows(db, 'SELECT document_id, from_offset, to_offset FROM status_event');
		expect(Number(rows[0].document_id)).toBe(1);
		expect(Number(rows[0].from_offset)).toBe(0);
		expect(Number(rows[0].to_offset)).toBe(1);
	});
});
