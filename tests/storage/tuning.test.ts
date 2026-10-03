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
		// Format 2 also carries the words read in the fully answered session (spec 013).
		const reviewed = data.words.find((w) => w.id === word.lexemeId)!;
		expect(reviewed.history.events).toHaveLength(1);
		expect(reviewed.history.answers).toEqual([[active, 'all']]);
		expect(evaluateDataset(data).eligible).toBe(1);
		expect(snapshot()).toEqual(before);
	} finally {
		db.close();
	}
});

it('exports format 2: tapped and fully-answered words without reviews too, with shown English', async () => {
	const db = await freshDatabase();
	try {
		const repo = new Repository(db);
		const [documentId] = await buildHistory(repo, ['我看书\n你好'], []);
		const words = repo.getDocument(documentId).tokens.filter((t) => t.isWord);
		const full = repo.startSession(documentId, 'media');
		const partial = repo.startSession(documentId, 'media');
		const at = '2026-10-04T10:00:00Z';
		const played = {
			kind: 'played',
			at,
			documentId,
			fromOffset: 0,
			toOffset: 6,
			mediaMs: 0,
			textVisible: true,
			detail: { toMs: 5000 }
		};
		const tapped = words[0];
		repo.recordEncounters(full, [
			played,
			{
				kind: 'lookup',
				at,
				documentId,
				lexemeId: tapped.lexemeId!,
				fromOffset: tapped.start,
				toOffset: tapped.end
			},
			{ kind: 'translation', at, documentId, fromOffset: 4, toOffset: 6, detail: { line: 1 } },
			{ kind: 'attention', at, detail: { answer: 'all' } }
		]);
		repo.recordEncounters(partial, [played, { kind: 'attention', at, detail: { answer: 'some' } }]);
		const data: unknown = JSON.parse(JSON.stringify(repo.tuningDataset()));
		validateDataset(data);
		expect(data).toMatchObject({ format: 2, rule: 'evidence-3' });
		const exported = new Map(data.words.map((w) => [w.id, w.history]));
		const lineOne = words.find((t) => t.start >= 4)!;
		expect([...exported.keys()].sort()).toEqual([...new Set(words.map((t) => t.lexemeId))].sort());
		expect(exported.get(lineOne.lexemeId!)!.exposures.map((e) => e.helped)).toContain(true);
	} finally {
		db.close();
	}
});
