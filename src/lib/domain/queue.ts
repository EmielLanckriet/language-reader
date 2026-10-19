/**
 * Which cards the flashcard page offers today, and in what order (spec 007 research R8, spec 019).
 * Pure: nothing about the queue is stored. Due cards are active words whose reading memory is due;
 * new cards are tapped words still retired, picked by general frequency up to the daily budget.
 */

import { State } from 'ts-fsrs';
import type { Memory } from './memory';
import type { Status } from './status';

export interface QueueCard {
	lexemeId: number;
	/** The reading memory: cards are reading cards (#7). */
	memory: Memory;
	status: Status;
	/** Tapped at least once: what makes a retired word one the budget may pick. */
	tapped: boolean;
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

	const active = cards.filter((card) => card.status === 'active');
	const candidates = cards.filter((card) => card.status === 'retired' && card.tapped);

	const room = Math.max(0, options.cap - options.firstReviewsToday);
	const rank = (card: QueueCard) => options.rank.get(card.lexemeId) ?? Infinity;

	return {
		due: active
			.filter((card) => due(card) <= now)
			.sort(byDue)
			.map((card) => card.lexemeId),
		soon: active
			.filter((card) => learning(card) && due(card) > now && due(card) <= now + LEARN_AHEAD_MS)
			.sort(byDue)
			.map((card) => card.lexemeId),
		fresh: candidates
			.sort((a, b) => rank(a) - rank(b) || a.lexemeId - b.lexemeId)
			.slice(0, room)
			.map((card) => card.lexemeId)
	};
}
