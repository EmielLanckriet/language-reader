import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';

// The sentence a reading card shows (research R9): the line it was first looked up in, then a
// different one on each later review where the library has another.

async function library() {
	const repository = new Repository(await freshDatabase());
	const [first, second] = await buildHistory(repository, ['我看书。他看你。', '你看我'], []);
	const tokens = repository.getDocument(first).tokens;
	const text = [...repository.getDocument(first).rawContent];
	// The 看 of 他看你, found by its text and its neighbour rather than by an offset.
	const kan = tokens.find((t) => t.isWord && text[t.start] === '看' && text[t.start - 1] === '他')!;
	return { repository, first, second, kan };
}

describe('a card’s sentence', () => {
	it('is the one the word was first looked up in', async () => {
		const { repository, first, kan } = await library();
		repository.recordEncounters(repository.startSession(first, 'reading'), [
			{
				kind: 'lookup',
				at: '2026-10-01T10:00:00Z',
				lexemeId: kan.lexemeId,
				documentId: first,
				fromOffset: 5,
				toOffset: 6
			}
		]);
		expect(repository.cardSentence(kan.lexemeId!)).toMatchObject({
			documentId: first,
			text: '他看你。',
			wordFrom: 1,
			wordTo: 2
		});
	});

	it('is a different one after a review showed it, while the library has another', async () => {
		const { repository, first, kan } = await library();
		for (const doc of repository.listDocuments()) {
			const text = repository.getDocument(doc.id).rawContent;
			repository.recordEncounters(repository.startSession(doc.id, 'reading'), [
				{
					kind: 'read',
					at: '2026-09-30T10:00:00Z',
					documentId: doc.id,
					fromOffset: 0,
					toOffset: [...text].length
				}
			]);
		}
		const shown = [repository.cardSentence(kan.lexemeId!)!];
		for (let i = 0; i < 2; i++) {
			const last = shown.at(-1)!;
			repository.recordReview(kan.lexemeId!, 3, {
				documentId: last.documentId!,
				fromOffset: last.from + last.wordFrom,
				toOffset: last.from + last.wordTo
			});
			shown.push(repository.cardSentence(kan.lexemeId!)!);
		}
		expect(shown[1].text).not.toBe(shown[0].text);
		expect(shown[2].text).not.toBe(shown[1].text);
		expect(new Set(shown.map((s) => s.text))).toEqual(new Set(['我看书。', '他看你。', '你看我']));
		expect(shown.every((s) => s.text.slice(s.wordFrom, s.wordTo) === '看')).toBe(true);
		void first;
	});

	it('is none for a word in no document', async () => {
		const { repository } = await library();
		expect(repository.cardSentence(repository.findOrCreateLexeme('zh', '将来'))).toBeUndefined();
	});
});

describe('today’s cards', () => {
	it('are the queue over the reading cards, new words by general frequency (issue #5)', async () => {
		const { repository, first, kan } = await library();
		const wo = repository.getDocument(first).tokens.find((token) => token.start === 0)!; // 我
		const session = repository.startSession(first, 'reading');
		repository.recordEncounters(session, [
			{
				kind: 'lookup',
				at: '2026-10-01T10:00:00Z',
				lexemeId: wo.lexemeId,
				documentId: first,
				fromOffset: 0,
				toOffset: 1
			},
			{
				kind: 'lookup',
				at: '2026-10-01T10:00:01Z',
				lexemeId: kan.lexemeId,
				documentId: first,
				fromOffset: 5,
				toOffset: 6
			}
		]);
		// 看 occurs three times in the library and 我 twice, but 我 is the more frequent in Chinese.
		repository.setFrequency(['的', '我', '你', '看']);
		const today = repository.cardsToday(1);
		expect(today.queue.fresh).toEqual([wo.lexemeId]);
		expect(today.words[wo.lexemeId!]).toBe('我');
		// And the other way round, so neither the library's counts nor the ids decide it.
		repository.setFrequency(['的', '看', '你', '我']);
		expect(repository.cardsToday(1).queue.fresh).toEqual([kan.lexemeId]);
		expect(today.counts).toEqual({ due: 0, fresh: 1, awaitingContext: 0 });
	});
});

it('excludes unread occurrences and withdrawn encounters, including from the queue', async () => {
	const { repository, first, kan } = await library();
	expect(repository.cardSentence(kan.lexemeId!)).toBeUndefined();
	const id = repository.startSession(first, 'reading');
	repository.recordEncounters(id, [
		{
			kind: 'lookup',
			at: '2026-09-30T10:00:00Z',
			lexemeId: kan.lexemeId,
			documentId: first,
			fromOffset: 5,
			toOffset: 6
		}
	]);
	expect(repository.cardSentence(kan.lexemeId!)?.text).toBe('他看你。');
	repository.recordReview(kan.lexemeId!, 3, { documentId: first, fromOffset: 5, toOffset: 6 });
	expect(repository.cardSentence(kan.lexemeId!)?.text).toBe('他看你。');
	repository.recordEncounters(id, [{ kind: 'withdrawn', at: '2026-09-30T11:00:00Z' }]);
	expect(repository.cardSentence(kan.lexemeId!)).toBeUndefined();
	expect(repository.cardsToday(10).counts.awaitingContext).toBe(1);
});

it('offers a known word as due outside the budget, stored and read back as known (issue #5)', async () => {
	const repository = new Repository(await freshDatabase());
	const [documentId] = await buildHistory(repository, ['我看书你好将来'], []);
	const word = repository.getDocument(documentId).tokens.find((t) => t.isWord)!.lexemeId!;
	for (const day of ['2026-10-01', '2026-10-03']) {
		repository.recordEncounters(repository.startSession(documentId, 'reading'), [
			{ kind: 'read', at: `${day}T10:00:00Z`, documentId, fromOffset: 0, toOffset: 7 },
			{ kind: 'attention', at: `${day}T10:05:00Z`, detail: { answer: 'all' } }
		]);
	}
	repository.refreshMemory(repository.staleMemory(1000));
	expect(repository.getMemory([word]).memory.get(word)?.reading?.known).toBe(true);
	const later = repository.cardsToday(0, new Date('2027-01-01T00:00:00Z'));
	expect(later.queue.due).toContain(word);
	expect(later.queue.fresh).toEqual([]);
});
