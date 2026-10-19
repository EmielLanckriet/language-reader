import { describe, it, expect } from 'vitest';
import { State } from 'ts-fsrs';
import { cardQueue, type QueueCard } from '../../src/lib/domain/queue';
import type { Memory } from '../../src/lib/domain/memory';
import type { Status } from '../../src/lib/domain/status';

// Which cards the flashcard page offers, and in what order (research R8).

const now = new Date('2026-10-10T12:00:00Z');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000).toISOString();
const days = (n: number) => minutes(n * 1440);

function card(
	lexemeId: number,
	memory: Partial<Memory>,
	status: Status = 'active',
	tapped = true
): QueueCard {
	return {
		lexemeId,
		status,
		tapped,
		memory: {
			stability: 10,
			difficulty: 5,
			state: State.Review,
			lastAt: days(-10),
			due: days(1),
			reps: 3,
			lapses: 0,
			...memory
		}
	};
}

const queue = (cards: QueueCard[], options: Partial<Parameters<typeof cardQueue>[1]> = {}) =>
	cardQueue(cards, { rank: new Map(), firstReviewsToday: 0, cap: 10, now, ...options });

describe('the card queue (spec 019)', () => {
	it('offers active words that are due, most overdue first', () => {
		const q = queue([
			card(1, { due: days(-1) }),
			card(2, { due: days(-5), seeded: 'anki' }),
			card(3, { due: days(2) })
		]);
		expect(q.due).toEqual([2, 1]);
	});

	it('never offers a retired or ignored word as due, however overdue', () => {
		const q = queue(
			[card(1, { due: days(-9) }, 'retired'), card(2, { due: days(-9) }, 'ignored')],
			{
				cap: 0
			}
		);
		expect(q).toEqual({ due: [], soon: [], fresh: [] });
	});

	it('offers tapped retired words as new, most frequent in Chinese first, up to the budget', () => {
		const fresh = [4, 5, 6, 7].map((id) =>
			card(id, { state: State.Learning, due: minutes(5) }, 'retired')
		);
		// A frequency rank, 0 the most frequent; 7 is not on the list at all, so rarest.
		const rank = new Map([
			[4, 9000],
			[5, 12],
			[6, 400]
		]);
		expect(queue(fresh, { rank, cap: 3 }).fresh).toEqual([5, 6, 4]);
		expect(queue(fresh, { rank, cap: 4 }).fresh).toEqual([5, 6, 4, 7]);
	});

	it('never offers an untapped, an active or an ignored word as new', () => {
		const q = queue([
			card(1, {}, 'retired', false),
			card(2, {}, 'active'),
			card(3, {}, 'ignored'),
			card(4, {}, 'retired')
		]);
		expect(q.fresh).toEqual([4]);
	});

	it('counts the new cards already begun today against the cap', () => {
		const fresh = [4, 5, 6].map((id) => card(id, { state: State.Learning }, 'retired'));
		expect(queue(fresh, { cap: 2, firstReviewsToday: 1 }).fresh).toEqual([4]);
		expect(queue(fresh, { cap: 2, firstReviewsToday: 5 }).fresh).toEqual([]);
	});

	it('keeps a word beyond the cap a candidate, offered on a later day', () => {
		const fresh = [4, 5].map((id) => card(id, { state: State.Learning }, 'retired'));
		expect(queue(fresh, { cap: 1 }).fresh).toEqual([4]);
		expect(queue(fresh, { cap: 1, now: new Date(days(1)) }).fresh).toEqual([4]);
		expect(queue([fresh[1]], { cap: 1 }).fresh).toEqual([5]);
	});

	it('brings back an active card answered Again within the session, once it is nearly due', () => {
		const again = card(7, { state: State.Relearning, due: minutes(8) });
		expect(queue([again]).due).toEqual([]);
		expect(queue([again]).soon).toEqual([7]);
		expect(queue([card(8, { state: State.Relearning, due: minutes(40) })]).soon).toEqual([]);
		expect(
			queue([card(9, { state: State.Relearning, due: minutes(8) }, 'retired')], { cap: 0 }).soon
		).toEqual([]);
	});
});
