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
	const kan = tokens.find((token) => token.isWord && token.start === 5)!; // 看 in 他看你
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
		const shown = [repository.cardSentence(kan.lexemeId!)!];
		for (let i = 0; i < 2; i++) {
			const last = shown.at(-1)!;
			repository.recordReview(kan.lexemeId!, 3, {
				documentId: last.documentId,
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
	it('are the queue over the reading cards, with each word and its library frequency', async () => {
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
		const today = repository.cardsToday(1);
		// 看 occurs three times in the library, 我 twice: the frequent one comes first.
		expect(today.queue.fresh).toEqual([kan.lexemeId]);
		expect(today.words[kan.lexemeId!]).toBe('看');
		expect(today.counts).toEqual({ due: 0, fresh: 1 });
	});
});
