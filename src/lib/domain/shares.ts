/**
 * How much of a document's running text the reader knows, is learning, or has never met: the
 * library's measure of how readable it is. Shares of word occurrences, so a word said forty times
 * weighs forty times.
 *
 * Known is FSRS's conclusion: recall of 85 % or more now, the read page's two strongest colours
 * (colourBand). A word with no memory is new. Neither marks nor status count (spec 019): an
 * ignored word is known or learning by its recall like any other.
 */
import { colourBand, recall, type Memory } from './memory';
import type { Skill } from './encounter';
import type { FsrsParameters } from './anki';
import type { Status } from './status';
import type { LexemeId } from './types';

export interface Shares {
	known: number;
	learning: number;
	fresh: number;
}

type Kind = keyof Shares;

/** How the library's shares count a word: what hardcore's coverage target counts as known too. */
export function kindOf(reading: Memory | undefined, now: Date, parameters?: FsrsParameters): Kind {
	if (!reading) return 'fresh';
	return colourBand(reading, now, parameters) <= 2 ? 'known' : 'learning';
}

/**
 * Distinct words: due ones (active cards whose reading recall is due now, so watching clears their
 * reviews; issue #5) with how often
 * they come up, and new ones with how many recur in 3 or more separate lines. Reading only: cards
 * are scheduled on reading; listening memory only nudges that, so a listening due date is no goal.
 */
export interface WordCounts {
	due: number;
	dueOccurrences: number;
	fresh: number;
	freshRecurring: number;
}

const RECURRING_LINES = 3;

/** Due as the library and Cards count it: an active card whose reading recall is due now. */
export function isDueWord(
	status: Status | undefined,
	reading: Memory | undefined,
	now: Date
): boolean {
	return status === 'active' && !!reading && Date.parse(reading.due) <= now.getTime();
}

export function wordCounts(
	occurrences: Map<LexemeId, number>,
	lines: Map<LexemeId, number>,
	statuses: Map<LexemeId, Status>,
	memory: Map<LexemeId, Partial<Record<Skill, Memory>>>,
	now: Date
): WordCounts {
	const counts: WordCounts = { due: 0, dueOccurrences: 0, fresh: 0, freshRecurring: 0 };
	for (const [lexeme, n] of occurrences) {
		const reading = memory.get(lexeme)?.reading;
		if (isDueWord(statuses.get(lexeme), reading, now)) {
			counts.due++;
			counts.dueOccurrences += n;
		}
		if (!reading) {
			counts.fresh++;
			if ((lines.get(lexeme) ?? 0) >= RECURRING_LINES) counts.freshRecurring++;
		}
	}
	return counts;
}

/** The in-force set's in-context noise (spec 013); the Anki baseline has none. */
export interface Noise {
	falseSuccess: number;
	falseFailure: number;
}

/**
 * Predicted comprehension (#13): the chance of understanding each running word in context today,
 * averaged over occurrences. Recall goes through the set's noise as the fit scores in-context
 * outcomes, so a fitted set's correction of an overconfident rule shows here too. New words count
 * 0.
 */
export function understood(
	occurrences: Map<LexemeId, number>,
	memory: Map<LexemeId, Partial<Record<Skill, Memory>>>,
	now: Date,
	parameters?: FsrsParameters,
	noise: Noise = { falseSuccess: 0, falseFailure: 0 }
): number | undefined {
	let sum = 0;
	let total = 0;
	for (const [lexeme, n] of occurrences) {
		const reading = memory.get(lexeme)?.reading;
		const chance = reading
			? noise.falseSuccess +
				(1 - noise.falseSuccess - noise.falseFailure) * recall(reading, now, parameters)
			: 0;
		sum += n * chance;
		total += n;
	}
	return total === 0 ? undefined : sum / total;
}

/** Fractions summing to 1, or undefined for a document with no counted words. */
export function textShares(
	occurrences: Map<LexemeId, number>,
	memory: Map<LexemeId, Partial<Record<Skill, Memory>>>,
	now: Date,
	parameters?: FsrsParameters
): Shares | undefined {
	const counts: Shares = { known: 0, learning: 0, fresh: 0 };
	for (const [lexeme, n] of occurrences)
		counts[kindOf(memory.get(lexeme)?.reading, now, parameters)] += n;
	const total = counts.known + counts.learning + counts.fresh;
	if (total === 0) return undefined;
	return {
		known: counts.known / total,
		learning: counts.learning / total,
		fresh: counts.fresh / total
	};
}
