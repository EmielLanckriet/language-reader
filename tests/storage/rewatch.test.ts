import { expect, it } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';

// A sentence seen before (issue #6), end to end: each session's exposure of a word says how many
// days ago its sentence was last read or watched, or nothing when one of its sentences was new.

it('dates each exposure from the last earlier viewing of the same sentence', async () => {
	const db = await freshDatabase();
	try {
		const repo = new Repository(db);
		const [id] = await buildHistory(repo, ['我看书\n我看书'], []);
		const word = repo.getDocument(id).tokens.find((t) => t.isWord && t.start === 0)!;
		const play = (day: number, lines: number[]) => {
			const session = repo.startSession(id, 'media');
			const at = new Date(Date.UTC(2026, 9, day, 10)).toISOString();
			repo.recordEncounters(session, [
				...lines.map((line) => ({
					kind: 'played',
					at,
					documentId: id,
					fromOffset: line * 4,
					toOffset: line * 4 + 3,
					mediaMs: line * 5000,
					textVisible: true,
					detail: { toMs: line * 5000 + 5000 }
				})),
				{ kind: 'attention', at, detail: { answer: 'all' } }
			]);
			return session;
		};
		// Withdrawn, the session's evidence counts for nothing; the sentence was still seen.
		repo.withdrawSession(play(1, [0]), 'test');
		play(3, [0]);
		play(4, [0, 1]);
		play(10, [1]);
		play(12, [0]);
		const exposures = repo
			.tuningDataset()
			.words.find((w) => w.id === word.lexemeId)!
			.history.exposures.map((e) => e.rewatchDays);
		expect(exposures).toEqual([2, undefined, 6, 8]);
	} finally {
		db.close();
	}
});
