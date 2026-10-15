import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';
import { open, seal } from '../../src/lib/backup/format';
import { validateDataset } from '../../src/lib/domain/tuning';
import { fitDataset } from '../../src/lib/domain/fit';

// Hardcore mode's records through storage (spec 014, ADR-0041).

async function library() {
	const repository = new Repository(await freshDatabase());
	const [first] = await buildHistory(repository, ['我看书。他看你。', '你看我'], []);
	const tokens = repository.getDocument(first).tokens;
	const word = (offset: number) => tokens.find((t) => t.start === offset)!;
	const wo = word(0);
	const kan = word(1);
	repository.recordEncounters(repository.startSession(first, 'reading'), [
		{
			kind: 'lookup',
			at: daysAgo(3),
			lexemeId: wo.lexemeId,
			documentId: first,
			fromOffset: 0,
			toOffset: 1
		},
		{
			kind: 'lookup',
			at: daysAgo(3),
			lexemeId: kan.lexemeId,
			documentId: first,
			fromOffset: 1,
			toOffset: 2
		}
	]);
	repository.setFrequency(['的', '我', '你', '看']);
	return { repository, first, wo: wo.lexemeId!, kan: kan.lexemeId! };
}

function daysAgo(days: number) {
	return new Date(Date.now() - days * 86_400_000).toISOString();
}

function drill(repository: Repository, documentId: number, lexemeId: number, at: string) {
	repository.recordEncounters(repository.startSession(documentId, 'hardcore'), [
		{
			kind: 'review',
			at,
			lexemeId,
			documentId,
			fromOffset: 1,
			toOffset: 2,
			detail: { skill: 'reading', grade: 3, hardcore: { part: 0 }, line: [0, 8] }
		}
	]);
}

describe('the new-word budget (FR-015)', () => {
	it('counts a first review on Cards today, not a drill', async () => {
		const { repository, first, wo, kan } = await library();
		expect(repository.cardsToday(1).queue.fresh).toEqual([wo]);
		drill(repository, first, kan, new Date().toISOString());
		expect(repository.cardsToday(1).queue.fresh).toEqual([wo]);
		repository.recordReview(kan, 3, { documentId: first, fromOffset: 1, toOffset: 2 });
		expect(repository.cardsToday(1).queue.fresh).toEqual([]);
	});

	it('counts the first Cards review today of a word drilled before', async () => {
		const { repository, first, wo, kan } = await library();
		drill(repository, first, kan, daysAgo(1));
		expect(repository.cardsToday(1).queue.fresh).toEqual([wo]);
		repository.recordReview(kan, 3, { documentId: first, fromOffset: 1, toOffset: 2 });
		expect(repository.cardsToday(1).queue.fresh).toEqual([]);
	});
});

describe('a drill in the learning data', () => {
	it('is accepted by the fit, from its hardcore session', async () => {
		const { repository, first, kan } = await library();
		drill(repository, first, kan, daysAgo(1));
		const data = JSON.parse(JSON.stringify(repository.tuningDataset()));
		expect(() => validateDataset(data)).not.toThrow();
		expect(() => fitDataset(data, { iterations: 2, gammas: [1] })).not.toThrow();
	});
});

describe('a hardcore session read back', () => {
	const plan = {
		start: 'beginning',
		fragment: [0, 0],
		cut: null,
		steps: ['drill', 'watch-after'],
		filters: {},
		order: 'frequency',
		parts: [{ lines: [0, 0], words: [1, 2] }]
	};

	it('gives its plan and steps in order, and the words passed in drills since a moment', async () => {
		const { repository, first, wo, kan } = await library();
		const session = repository.startSession(first, 'hardcore');
		const now = new Date().toISOString();
		repository.recordEncounters(session, [
			{ kind: 'hardcore-plan', at: now, detail: plan },
			{ kind: 'hardcore-step', at: now, detail: { part: 0, step: 'drill', at: 'start' } }
		]);
		drill(repository, first, kan, now);
		const shu = repository.getDocument(first).tokens.find((t) => t.start === 2)!.lexemeId!;
		repository.recordEncounters(session, [
			{
				kind: 'review',
				at: now,
				lexemeId: shu,
				documentId: first,
				fromOffset: 2,
				toOffset: 3,
				detail: { skill: 'reading', grade: 2, hardcore: { part: 0 }, line: [0, 8] }
			},
			{
				kind: 'review',
				at: now,
				lexemeId: wo,
				documentId: first,
				fromOffset: 0,
				toOffset: 1,
				detail: { skill: 'reading', grade: 1, hardcore: { part: 0 }, line: [0, 8] }
			},
			{ kind: 'hardcore-step', at: now, detail: { part: 0, step: 'drill', at: 'end' } }
		]);
		expect(repository.hardcoreSession(session)).toEqual({
			documentId: first,
			plan,
			steps: [
				{ part: 0, step: 'drill', at: 'start' },
				{ part: 0, step: 'drill', at: 'end' }
			]
		});
		// 我 was graded Again only: not passed. 书 passed on Hard; 看 passed, in another session.
		expect(repository.drilledSince(daysAgo(1))).toEqual([kan, shu].sort((a, b) => a - b));
		expect(repository.drilledSince(now)).toEqual([kan, shu].sort((a, b) => a - b));
		expect(repository.drilledSince(new Date(Date.now() + 1000).toISOString())).toEqual([]);
	});

	it('ranks words by general frequency, unlisted ones absent', async () => {
		const { repository, wo, kan } = await library();
		const ranks = repository.frequencyRanks([wo, kan]);
		expect(ranks.get(wo)).toBe(1);
		expect(ranks.get(kan)).toBe(3);
		repository.setFrequency(['的']);
		expect(repository.frequencyRanks([wo]).has(wo)).toBe(false);
	});
});

describe('a drill in the rest of the history (FR-017)', () => {
	it('is taken back with the document, survives a backup, and counts toward study days', async () => {
		const { repository, first, kan } = await library();
		const now = new Date().toISOString();
		const session = repository.startSession(first, 'hardcore');
		repository.recordEncounters(session, [
			{
				kind: 'hardcore-plan',
				at: now,
				detail: {
					start: 'beginning',
					fragment: [0, 0],
					cut: null,
					steps: ['drill'],
					filters: {},
					order: 'story',
					parts: [{ lines: [0, 0], words: [kan] }]
				}
			},
			{ kind: 'hardcore-step', at: now, detail: { part: 0, step: 'drill', at: 'start' } },
			...[1, 3, 3, 3, 3].map((grade) => ({
				kind: 'review',
				at: now,
				lexemeId: kan,
				documentId: first,
				fromOffset: 1,
				toOffset: 2,
				detail: { skill: 'reading', grade, hardcore: { part: 0 }, line: [0, 8] }
			})),
			{ kind: 'hardcore-step', at: now, detail: { part: 0, step: 'drill', at: 'end' } }
		]);
		const reps = () => repository.getMemory([kan]).memory.get(kan)?.reading?.reps;
		// The library's tap, then every drill grade, Again included.
		expect(reps()).toBe(6);

		const overview = repository.studyOverview('UTC', new Date());
		expect(overview.week.days.find((d) => d.date === overview.week.today)?.reviews).toBe(5);
		expect(overview.sessions.some((s) => s.modality === 'hardcore')).toBe(false);

		const body = repository.exportBody('test', now);
		const target = new Repository(await freshDatabase());
		target.restoreCopy(await open(JSON.stringify(await seal(body))));
		expect(target.exportBody('test', now)).toEqual(body);
		expect(target.hardcoreSession(session)).toEqual(repository.hardcoreSession(session));

		repository.withdrawDocument(first, 'test');
		expect(reps()).toBeUndefined();
		expect(repository.drilledSince('2000-01-01T00:00:00Z')).toEqual([]);
	});
});
