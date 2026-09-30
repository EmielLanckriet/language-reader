import { expect, it } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';
import { queryRows } from '../../src/lib/storage/db';
import { evaluateDataset, validateDataset } from '../../src/lib/domain/tuning';

it('exports retained reviewed history with attention, omits withdrawn sessions, and writes nothing', async () => {
	const db = await freshDatabase();
	try {
		const repo = new Repository(db);
		const [documentId] = await buildHistory(repo, ['你好'], []);
		const word = repo.getDocument(documentId).tokens.find((t) => t.isWord)!;
		const active = repo.startSession(documentId, 'reading');
		const withdrawn = repo.startSession(documentId, 'reading');
		const review = {
			kind: 'review',
			at: '2026-01-03T00:00:00Z',
			lexemeId: word.lexemeId!,
			detail: { skill: 'reading', grade: 1 }
		};
		repo.recordEncounters(active, [
			{ kind: 'read', at: '2026-01-01T00:00:00Z', documentId, fromOffset: 0, toOffset: 2 },
			{ kind: 'attention', at: '2026-01-01T00:01:00Z', detail: { answer: 'all' } },
			review
		]);
		repo.recordEncounters(withdrawn, [review, { kind: 'withdrawn', at: '2026-01-04T00:00:00Z' }]);
		const snapshot = () =>
			['encounter', 'status_event', 'memory'].map((table) =>
				queryRows(db, `SELECT * FROM ${table}`)
			);
		const before = snapshot();
		const data = JSON.parse(JSON.stringify(repo.tuningDataset()));
		validateDataset(data);
		expect(data.words).toHaveLength(1);
		expect(data.words[0].history.events).toHaveLength(1);
		expect(data.words[0].history.answers).toEqual([[active, 'all']]);
		expect(evaluateDataset(data).eligible).toBe(1);
		expect(snapshot()).toEqual(before);
	} finally {
		db.close();
	}
});
