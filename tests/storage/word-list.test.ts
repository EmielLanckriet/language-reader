import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';

// Issue #47: every word with a memory or a mark, and on opening one, where it was met.

async function library() {
	const repository = new Repository(await freshDatabase());
	const [first, second] = await buildHistory(repository, ['我你', '书好'], []);
	const id = (word: string) => repository.findOrCreateLexeme('zh', word);
	const session = repository.startSession(first, 'reading');
	repository.recordEncounters(session, [
		{ kind: 'read', at: '2026-10-06T10:00:00Z', documentId: first, fromOffset: 0, toOffset: 2 },
		// A read becomes memory once the session's attention answer says everything was followed.
		{ kind: 'attention', at: '2026-10-06T10:01:00Z', detail: { answer: 'all' } }
	]);
	repository.assertState(id('书'), 'retired');
	return { repository, first, second, session, id };
}

describe('the word list', () => {
	it('holds words with a memory or a mark, and no other', async () => {
		const { repository, id } = await library();
		const list = new Map(repository.wordList().words.map((word) => [word.id, word]));
		expect(list.get(id('我'))?.form).toBe('我');
		expect(list.get(id('我'))?.reading?.stability).toBeGreaterThan(0);
		expect(list.get(id('我'))?.mark).toBeUndefined();
		expect(list.get(id('书'))?.mark).toBe('retired');
		expect(list.has(id('好'))).toBe(false);
	});

	it('says where a word was met, without withdrawn sessions, and lists its marks', async () => {
		const { repository, first, session, id } = await library();
		expect(repository.wordDetail(id('我')).met).toEqual([{ documentId: first, title: '我你' }]);
		// 书 is in the second text, which was never read.
		const marked = repository.wordDetail(id('书'));
		expect(marked.met).toEqual([]);
		expect(marked.marks.map((mark) => mark.asserted)).toEqual(['retired']);

		repository.withdrawSession(session, 'test');
		expect(repository.wordDetail(id('我')).met).toEqual([]);
	});
});
