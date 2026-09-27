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

export interface QueueOptions {
	/** How often each word occurs in the library: new cards are shown most frequent first. */
	frequency: Map<number, number>;
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
	const cardsOnly = cards.filter((card) => card.memory.card);

	const reviewed = cardsOnly.filter((card) => card.memory.reviewed);
	const seeded = cardsOnly.filter((card) => !card.memory.reviewed && card.memory.seeded);
	const fresh = cardsOnly.filter((card) => !card.memory.reviewed && !card.memory.seeded);

	const room = Math.max(0, options.cap - options.firstReviewsToday);
	const often = (card: QueueCard) => options.frequency.get(card.lexemeId) ?? 0;

	return {
		due: [
			...reviewed.filter((card) => due(card) <= now).sort(byDue),
			...seeded.filter((card) => due(card) <= now).sort(byDue)
		].map((card) => card.lexemeId),
		soon: reviewed
			.filter((card) => learning(card) && due(card) > now && due(card) <= now + LEARN_AHEAD_MS)
			.sort(byDue)
			.map((card) => card.lexemeId),
		fresh: fresh
			.sort((a, b) => often(b) - often(a) || a.lexemeId - b.lexemeId)
			.slice(0, room)
			.map((card) => card.lexemeId)
	};
}
