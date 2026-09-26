import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from './support';
import { buildHistory, dump } from '../backup/support';

// Deleting a document the reader made no judgment in. A judgment's event can point at the document
// it was made in, and the event log is earned data: a document any event points at is refused,
// and nothing is written. Lexemes stay whatever happens, because marks point at them.

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

		repository.deleteUnmarkedDocument(gone);

		const after = repository.exportBody('test', 'now');
		expect(repository.listDocuments().map((document) => document.id)).toEqual([kept]);
		expect(after.events).toEqual(before.events);
		expect(after.states).toEqual(before.states);
		expect(dump(db)).not.toContain('"document_id":' + gone);
	});

	it('refuses a document a judgment points at, and writes nothing', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		const [marked] = await buildHistory(
			repository,
			['我看书'],
			[{ document: 0, word: 1, state: 'learning' }]
		);
		const before = dump(db);

		expect(() => repository.deleteUnmarkedDocument(marked)).toThrow(/judgment/);
		expect(dump(db)).toBe(before);
	});
});
