import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Repository } from '../../src/lib/storage/repository';
import { parseAnkiExport } from '../../src/lib/domain/anki';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';

// The reader, 2026-10-07: Anki words outside the most common are set aside. One comes back only by
// coming up in what they read or watch, as a new-word candidate ranked by general frequency, and is
// due again once reviewed in Reader. Anki example sentences do not count as coming up.

const fixture = parseAnkiExport(readFileSync('tests/fixtures/anki/anki-words-v2.json', 'utf8'));
// The test analyzer splits by character, so the Anki words are single characters here.
const anki = {
	...fixture,
	words: ['我', '书', '好', '看', '你'].map((word, i) => ({ ...fixture.words[i % 2], word }))
};
const FAR = new Date('2030-01-01T00:00:00Z');

async function library() {
	const repository = new Repository(await freshDatabase());
	const [first, second] = await buildHistory(repository, ['我你', '书好'], []);
	repository.importAnki(anki);
	// 我 is among the 2 most common; 书, 好 and 看 are not.
	repository.setFrequency(['的', '我', '书', '好']);
	const id = (word: string) => repository.findOrCreateLexeme('zh', word);
	return { repository, first, second, id };
}

describe('setting Anki words aside', () => {
	it('counts on a dry run, marks only Anki words outside the top, and only once', async () => {
		const { repository, id } = await library();
		repository.assertState(id('你'), 'learning');
		expect(repository.setAsideAnki(2, true)).toBe(3);
		expect(repository.getStates([id('书')]).get(id('书'))?.state).toBe('anki-mature');
		expect(repository.setAsideAnki(2, false)).toBe(3);
		const states = repository.getStates([id('我'), id('书'), id('好'), id('看'), id('你')]);
		expect(states.get(id('我'))?.state).toBe('anki-long-term');
		expect(states.get(id('书'))?.state).toBe('retired');
		expect(states.get(id('看'))?.state).toBe('retired');
		expect(states.get(id('你'))?.state).toBe('learning');
		expect(repository.setAsideAnki(2, false)).toBe(0);
	});

	it('is never due; a word that came up is a ranked candidate, due again once reviewed', async () => {
		const { repository, first, second, id } = await library();
		repository.recordEncounters(repository.startSession(first, 'reading'), [
			{ kind: 'read', at: '2026-10-06T10:00:00Z', documentId: first, fromOffset: 0, toOffset: 2 }
		]);
		repository.importCardExamples([
			{
				key: 't:1',
				word: '看',
				text: '看书。',
				translation: 'Illegal.',
				pinyin: 'kàn shū',
				profile: 'T',
				noteId: '1',
				original: { SentenceSimplified: '看书。' }
			}
		]);
		repository.setAsideAnki(2, false);
		const before = repository.cardsToday(10, FAR);
		for (const word of ['书', '好', '看']) {
			expect(before.queue.due).not.toContain(id(word));
			expect(before.queue.fresh).not.toContain(id(word));
		}
		expect(before.queue.due).not.toContain(id('你'));
		expect(before.queue.due).toContain(id('我'));

		repository.recordEncounters(repository.startSession(second, 'reading'), [
			{ kind: 'read', at: '2026-10-07T10:00:00Z', documentId: second, fromOffset: 0, toOffset: 2 }
		]);
		// 看 has only an Anki example sentence: that is not coming up. 你, unranked, comes last.
		const met = repository.cardsToday(10, FAR);
		expect(met.queue.fresh).toEqual([id('书'), id('好'), id('你')]);
		expect(met.queue.due).not.toContain(id('书'));

		repository.recordReview(id('书'), 3, undefined, '2026-10-07T11:00:00Z');
		const reviewed = repository.cardsToday(10, FAR);
		expect(reviewed.queue.due).toContain(id('书'));
		expect(reviewed.queue.fresh).toEqual([id('好'), id('你')]);
	});
});
