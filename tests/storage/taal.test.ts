import { describe, expect, it } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';

// What the Taal share is computed from (spec 020, research R4).

async function library() {
	const repository = new Repository(await freshDatabase());
	const [document] = await buildHistory(repository, ['我看书。他看你。'], []);
	const tokens = repository.getDocument(document).tokens;
	const word = tokens.find((t) => t.start === 1)!;
	return { repository, document, lexemeId: word.lexemeId! };
}

const minute = (at: string) => ({ kind: 'study-time', at, detail: { durationMs: 60000 } });

describe('taalInputs', () => {
	it('gives study time with each session’s latest look-up answer, leaving out withdrawn sessions', async () => {
		const { repository, document } = await library();
		const thorough = repository.startSession(document, 'reading');
		repository.recordEncounters(thorough, [
			minute('2026-10-26T10:01:00Z'),
			{ kind: 'attention', at: '2026-10-26T10:02:00Z', detail: { answer: 'some' } },
			{ kind: 'attention', at: '2026-10-26T10:03:00Z', detail: { answer: 'all' } }
		]);
		const withdrawn = repository.startSession(document, 'reading');
		repository.recordEncounters(withdrawn, [minute('2026-10-26T11:01:00Z')]);
		repository.withdrawSession(withdrawn, 'a test');
		const earlier = repository.startSession(document, 'reading');
		repository.recordEncounters(earlier, [minute('2026-10-20T11:01:00Z')]);

		const inputs = repository.taalInputs('2026-10-25T00:00:00Z');
		expect(inputs.studyTime).toEqual([
			{ at: '2026-10-26T10:01:00Z', durationMs: 60000, sessionId: thorough }
		]);
		expect(inputs.answers).toEqual([{ sessionId: thorough, answer: 'all' }]);
	});

	it('gives Cards reviews but not drill grades as cards, and each drill part’s marks', async () => {
		const { repository, document, lexemeId } = await library();
		repository.recordReview(lexemeId, 3, undefined, '2026-10-26T09:00:00Z');
		repository.recordReview(lexemeId, 3, undefined, '2026-10-20T09:00:00Z');
		const hardcore = repository.startSession(document, 'hardcore');
		const step = (part: number, at: 'start' | 'end', when: string) => ({
			kind: 'hardcore-step',
			at: when,
			detail: { part, step: 'drill', at }
		});
		const grade = (part: number, when: string) => ({
			kind: 'review',
			at: when,
			lexemeId,
			documentId: document,
			fromOffset: 1,
			toOffset: 2,
			detail: { skill: 'reading', grade: 3, hardcore: { part }, line: [0, 4] }
		});
		repository.recordEncounters(hardcore, [
			{
				kind: 'hardcore-step',
				at: '2026-10-26T09:55:00Z',
				detail: { part: 0, step: 'watch-first', at: 'start' }
			},
			step(0, 'start', '2026-10-26T10:00:00Z'),
			grade(0, '2026-10-26T10:05:00Z'),
			step(0, 'end', '2026-10-26T10:14:00Z'),
			step(1, 'start', '2026-10-26T10:20:00Z'),
			grade(1, '2026-10-26T10:27:00Z')
		]);

		const inputs = repository.taalInputs('2026-10-25T00:00:00Z');
		expect(inputs.cards).toEqual([{ at: '2026-10-26T09:00:00Z' }]);
		expect(inputs.drills).toEqual([
			{
				start: '2026-10-26T10:00:00Z',
				end: '2026-10-26T10:14:00Z',
				lastGrade: '2026-10-26T10:05:00Z'
			},
			{ start: '2026-10-26T10:20:00Z', end: null, lastGrade: '2026-10-26T10:27:00Z' }
		]);
	});
});
