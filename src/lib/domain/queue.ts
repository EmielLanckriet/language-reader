/**
 * Which cards the flashcard page offers today, and in what order (spec 007, research R8). Pure:
 * nothing about the queue is stored, since a card is made by events already in the history.
 */

import { State } from 'ts-fsrs';
import type { Memory } from './memory';

export interface QueueCard {
	lexemeId: number;
	/** The reading memory: cards are reading cards in this slice. */
	memory: Memory;
}

/**
 * A card that comes due on its own schedule, outside the new-word budget (issue #5): reviewed in
 * Reader, seen in Anki, or a known word. Any other card is a candidate the budget may pick.
 */
export function isActive(memory: Memory): boolean {
	return memory.reviewed || memory.seeded !== undefined || memory.known === true;
}

export interface QueueOptions {
	/**
	 * Each word's rank in general Chinese frequency, 0 the most frequent; a word not ranked is the
	 * rarest. New cards are picked most frequent first: how often a word occurs in the reader's own
	 * library does not matter, since they meet those words by watching anyway (issue #5).
	 */
	rank: Map<number, number>;
	/** New cards already reviewed for the first time today, which count against the cap. */
	firstReviewsToday: number;
	cap: number;
	now: Date;
}

export interface Queue {
	due: number[];
	/** In (re)learning and due within the learn-ahead window: an Again coming back this session. */
	soon: number[];
	fresh: number[];
}

/** Anki's learn-ahead limit: a card still being learned is shown up to this early. */
const LEARN_AHEAD_MS = 20 * 60_000;

export function cardQueue(cards: QueueCard[], options: QueueOptions): Queue {
	const now = options.now.getTime();
	const due = (card: QueueCard) => new Date(card.memory.due).getTime();
	const byDue = (a: QueueCard, b: QueueCard) => due(a) - due(b) || a.lexemeId - b.lexemeId;
	const learning = (card: QueueCard) =>
		card.memory.state === State.Learning || card.memory.state === State.Relearning;
	const cardsOnly = cards.filter((card) => card.memory.card || card.memory.known);

	const reviewed = cardsOnly.filter((card) => card.memory.reviewed);
	const scheduled = cardsOnly.filter((card) => !card.memory.reviewed && isActive(card.memory));
	const fresh = cardsOnly.filter((card) => !isActive(card.memory));

	const room = Math.max(0, options.cap - options.firstReviewsToday);
	const rank = (card: QueueCard) => options.rank.get(card.lexemeId) ?? Infinity;

	return {
		due: [
			...reviewed.filter((card) => due(card) <= now).sort(byDue),
			...scheduled.filter((card) => due(card) <= now).sort(byDue)
		].map((card) => card.lexemeId),
		soon: reviewed
			.filter((card) => learning(card) && due(card) > now && due(card) <= now + LEARN_AHEAD_MS)
			.sort(byDue)
			.map((card) => card.lexemeId),
		fresh: fresh
			.sort((a, b) => rank(a) - rank(b) || a.lexemeId - b.lexemeId)
			.slice(0, room)
			.map((card) => card.lexemeId)
	};
}
