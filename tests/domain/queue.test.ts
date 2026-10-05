import { describe, it, expect } from 'vitest';
import { State } from 'ts-fsrs';
import { cardQueue, type QueueCard } from '../../src/lib/domain/queue';
import type { Memory } from '../../src/lib/domain/memory';

// Which cards the flashcard page offers, and in what order (research R8).

const now = new Date('2026-10-10T12:00:00Z');
const minutes = (n: number) => new Date(now.getTime() + n * 60_000).toISOString();
const days = (n: number) => minutes(n * 1440);

function card(lexemeId: number, memory: Partial<Memory>): QueueCard {
	return {
		lexemeId,
		memory: {
			stability: 10,
			difficulty: 5,
			state: State.Review,
			lastAt: days(-10),
			due: days(1),
			reps: 3,
			lapses: 0,
			card: true,
			reviewed: true,
			...memory
		}
	};
}

const queue = (cards: QueueCard[], options: Partial<Parameters<typeof cardQueue>[1]> = {}) =>
	cardQueue(cards, { rank: new Map(), firstReviewsToday: 0, cap: 10, now, ...options });

describe('the card queue', () => {
	it('offers reviewed cards that are due, most overdue first', () => {
		const q = queue([
			card(1, { due: days(-1) }),
			card(2, { due: days(-5) }),
			card(3, { due: days(2) })
		]);
		expect(q.due).toEqual([2, 1]);
	});

	it('offers due Anki words after the reviewed ones', () => {
		const q = queue([
			card(1, { due: days(-1), reviewed: false, seeded: 'anki' }),
			card(2, { due: days(-1) }),
			card(3, { due: days(-9), reviewed: false, seeded: 'anki' })
		]);
		expect(q.due).toEqual([2, 3, 1]);
	});

	it('offers new words most frequent in Chinese first, up to the budget (issue #5)', () => {
		const fresh = [4, 5, 6, 7].map((id) =>
			card(id, { reviewed: false, state: State.Learning, due: minutes(5) })
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

	it('offers a known word when due, outside the new-word budget (issue #5)', () => {
		const known = card(8, { reviewed: false, card: false, known: true, due: days(-1) });
		const q = queue([known, card(9, { reviewed: false, due: days(-1) })], { cap: 0 });
		expect(q.due).toEqual([8]);
		expect(q.fresh).toEqual([]);
	});

	it('counts the new cards already begun today against the cap', () => {
		const fresh = [4, 5, 6].map((id) => card(id, { reviewed: false, state: State.Learning }));
		expect(queue(fresh, { cap: 2, firstReviewsToday: 1 }).fresh).toEqual([4]);
		expect(queue(fresh, { cap: 2, firstReviewsToday: 5 }).fresh).toEqual([]);
	});

	it('keeps a card beyond the cap a card, offered on a later day', () => {
		const fresh = [4, 5].map((id) => card(id, { reviewed: false, state: State.Learning }));
		expect(queue(fresh, { cap: 1 }).fresh).toEqual([4]);
		expect(queue(fresh, { cap: 1, now: new Date(days(1)) }).fresh).toEqual([4]);
		expect(queue([fresh[1]], { cap: 1 }).fresh).toEqual([5]);
	});

	it('brings back a card answered Again within the session, once it is nearly due', () => {
		const again = card(7, { state: State.Relearning, due: minutes(8) });
		expect(queue([again]).due).toEqual([]);
		expect(queue([again]).soon).toEqual([7]);
		expect(queue([card(8, { state: State.Relearning, due: minutes(40) })]).soon).toEqual([]);
	});

	it('offers nothing that is not a card', () => {
		const q = queue([card(9, { card: false, due: days(-3), reviewed: false })]);
		expect(q).toEqual({ due: [], soon: [], fresh: [] });
	});
});
