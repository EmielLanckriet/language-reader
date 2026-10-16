import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { queryRows } from '../../src/lib/storage/db';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';
import { heardOn } from '../../src/lib/domain/card-help';

// What a card gave besides the word before its grade (#37, ADR-0042): earned, recorded as facts.

async function library() {
	const db = await freshDatabase();
	const repository = new Repository(db);
	const [first] = await buildHistory(repository, ['我看书。'], []);
	const text = [...repository.getDocument(first).rawContent];
	const kan = repository.getDocument(first).tokens.find((t) => t.isWord && text[t.start] === '看')!;
	const details = () =>
		queryRows(db, "SELECT detail FROM encounter WHERE kind = 'review' ORDER BY id").map((row) =>
			JSON.parse(String(row.detail))
		);
	return { repository, first, kan, details };
}

describe('a review', () => {
	it('records the sentence on the front and the recordings played, by face', async () => {
		const { repository, first, kan, details } = await library();
		const shown = { documentId: first, fromOffset: 1, toOffset: 2 };
		repository.recordReview(kan.lexemeId!, 2, shown, '2026-10-16T08:00:00Z', undefined, {
			sentenceShown: true,
			heard: { sentence: 'front', word: 'back' }
		});
		repository.recordReview(kan.lexemeId!, 3, undefined, '2026-10-17T08:00:00Z', undefined, {
			sentenceShown: false,
			heard: {}
		});
		expect(details()).toEqual([
			{
				skill: 'reading',
				grade: 2,
				sentenceShown: true,
				heard: { sentence: 'front', word: 'back' }
			},
			{ skill: 'reading', grade: 3, sentenceShown: false, heard: {} }
		]);

		const word = repository.tuningDataset().words.find((w) => w.id === kan.lexemeId)!;
		expect(word.history.events.map((e) => e.detail.heard)).toEqual([
			{ sentence: 'front', word: 'back' },
			{}
		]);
	});

	it('recorded without them says nothing about them', async () => {
		const { repository, kan, details } = await library();
		repository.recordReview(kan.lexemeId!, 3, undefined, '2026-10-16T08:00:00Z');
		expect(details()).toEqual([{ skill: 'reading', grade: 3 }]);
	});
});

describe('a recording', () => {
	it('counts on the face it was first played on', () => {
		let heard = heardOn({}, 'sentence', false);
		heard = heardOn(heard, 'sentence', true);
		heard = heardOn(heard, 'word', true);
		expect(heard).toEqual({ sentence: 'front', word: 'back' });
	});
});
