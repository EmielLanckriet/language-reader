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

// Hardcore mode (spec 014, FR-016): a line shown on a drill card was seen, for every word on it.
it('dates an exposure from a drill card that showed its line, and from nothing else', async () => {
	const db = await freshDatabase();
	try {
		const repo = new Repository(db);
		const [id] = await buildHistory(repo, ['我看书\n他看你'], []);
		const tokens = repo.getDocument(id).tokens;
		const at = (day: number, hour: number) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();
		const play = (when: string, line: number) =>
			repo.recordEncounters(repo.startSession(id, 'media'), [
				{
					kind: 'played',
					at: when,
					documentId: id,
					fromOffset: line * 4,
					toOffset: line * 4 + 3,
					mediaMs: line * 5000,
					textVisible: true,
					detail: { toMs: line * 5000 + 5000 }
				},
				{ kind: 'attention', at: when, detail: { answer: 'all' } }
			]);
		// 我 drilled on line 0; 看 is on that line too.
		repo.recordEncounters(repo.startSession(id, 'hardcore'), [
			{
				kind: 'review',
				at: at(1, 9),
				lexemeId: tokens[0].lexemeId,
				documentId: id,
				fromOffset: 0,
				toOffset: 1,
				detail: { skill: 'reading', grade: 3, hardcore: { part: 0 }, line: [0, 3] }
			}
		]);
		play(at(1, 10), 0);
		// 看 on line 1 reviewed on Cards, its sentence shown: not counted as seen.
		const kan = tokens.find((t) => t.start === 5)!;
		repo.recordReview(kan.lexemeId!, 3, { documentId: id, fromOffset: 5, toOffset: 6 }, at(2, 9));
		play(at(2, 10), 1);
		const exposures = (lexemeId: number) =>
			repo
				.tuningDataset()
				.words.find((w) => w.id === lexemeId)!
				.history.exposures.map((e) => e.rewatchDays);
		const [first, second] = exposures(kan.lexemeId!);
		expect(first).toBeCloseTo(1 / 24, 6);
		expect(second).toBeUndefined();
		// The drill itself is no exposure of 我: only the watching an hour later is. Both ends of the
		// drilled line count as seen: 我 starts it, 书 ends it.
		expect(exposures(tokens[0].lexemeId!)).toHaveLength(1);
		expect(exposures(tokens[0].lexemeId!)[0]).toBeCloseTo(1 / 24, 6);
		expect(exposures(tokens[2].lexemeId!)[0]).toBeCloseTo(1 / 24, 6);
	} finally {
		db.close();
	}
});
