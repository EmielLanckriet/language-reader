import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from './support';
import { buildHistory, dump } from '../backup/support';

// Deleting a document. A mark, a session or an encounter can point at the document it was made in,
// and that history is earned data: such a document is hidden and kept, text and all (spec 007, R11).
// One nothing points at is deleted. Lexemes stay whatever happens, because marks point at them.

describe('deleting a document', () => {
	it('removes an unmarked document and its tokens, and nothing else', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		const [kept, gone] = await buildHistory(
			repository,
			['我看书', '你好'],
			[{ document: 0, word: 0, state: 'known' }]
		);
		const before = repository.exportBody('test', 'now');

		repository.removeDocument(gone);

		const after = repository.exportBody('test', 'now');
		expect(repository.listDocuments().map((document) => document.id)).toEqual([kept]);
		expect(after.events).toEqual(before.events);
		expect(after.states).toEqual(before.states);
		expect(dump(db)).not.toContain('"document_id":' + gone);
	});

	it('hides a document a judgment points at, keeping its text and history', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		const [marked] = await buildHistory(
			repository,
			['我看书'],
			[{ document: 0, word: 1, state: 'learning' }]
		);
		const before = repository.exportBody('test', 'now');

		expect(repository.removeDocument(marked)).toBe('hidden');

		expect(repository.listDocuments()).toEqual([]);
		expect(repository.getDocument(marked).rawContent).toBe('我看书');
		const after = repository.exportBody('test', 'now');
		expect(after.events).toEqual(before.events);
		expect(after.documents[0].removedAt).toBeDefined();
	});

	it('hides a document with only reading history in it', async () => {
		const repository = new Repository(await freshDatabase());
		const [read] = await buildHistory(repository, ['你好'], []);
		repository.startSession(read, 'reading');

		expect(repository.removeDocument(read)).toBe('hidden');
		expect(repository.listDocuments()).toEqual([]);
		expect(repository.exportBody('test', 'now').sessions).toHaveLength(1);
	});
});

// New subtitles for a video (issue #9) are a new document in the old one's place: the library shows
// it where the old one was, and the old one is hidden like a deleted one, its history still counting.
describe('replacing a document', () => {
	it('puts the replacement in the old place and hides the old one', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		const [older, old, newer] = await buildHistory(repository, ['我看书', '你好', '他来'], []);
		['2026-01-01', '2026-02-01', '2026-03-01'].forEach((day, i) =>
			db.exec(
				`UPDATE document SET created_at = '${day}T00:00:00Z' WHERE id = ${[older, old, newer][i]}`
			)
		);
		repository.startSession(old, 'media');
		const [replacement] = await buildHistory(repository, ['你好吗'], []);
		const before = repository.exportBody('test', 'now');

		expect(repository.replaceDocument(old, replacement)).toBe('hidden');

		expect(repository.listDocuments().map((d) => d.id)).toEqual([newer, replacement, older]);
		const after = repository.exportBody('test', 'now');
		expect(after.sessions).toEqual(before.sessions);
		expect(after.documents.find((d) => d.id === old)?.removedAt).toBeDefined();
	});
});
