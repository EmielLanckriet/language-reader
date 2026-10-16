/**
 * How much of a document's running text the reader knows, is learning, or has never met: the
 * library's measure of how readable it is. Shares of word occurrences, so a word said forty times
 * weighs forty times; ignored words (names, noise) are left out of the whole.
 *
 * Known is FSRS's conclusion where there is one: recall of 85 % or more now, the read page's two
 * strongest colours (colourBand). A word with no memory falls back on the reader's marks, and on
 * Anki's levels from an import.
 */
import { colourBand, recall, type Memory } from './memory';
import { isActive } from './queue';
import type { Skill } from './encounter';
import type { FsrsParameters } from './anki';
import type { LexemeId, WordState } from './types';

export interface Shares {
	known: number;
	learning: number;
	fresh: number;
}

type Kind = keyof Shares;

const KNOWN_MARKS = new Set(['known', 'anki-mature', 'anki-long-term']);
const NO_MARK = new Set(['ignored', '(none)']);

/** How the library's shares count a word: what hardcore's coverage target counts as known too. */
export function kindOf(
	state: string | undefined,
	reading: Memory | undefined,
	now: Date,
	parameters?: FsrsParameters
): Kind | 'ignored' {
	if (state === 'ignored') return 'ignored';
	if (reading) return colourBand(reading, now, parameters) <= 2 ? 'known' : 'learning';
	if (state === undefined || NO_MARK.has(state)) return 'fresh';
	return KNOWN_MARKS.has(state) ? 'known' : 'learning';
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
	state: string | undefined,
	reading: Memory | undefined,
	now: Date,
	parameters?: FsrsParameters
): boolean {
	if (!reading || kindOf(state, reading, now, parameters) === 'ignored') return false;
	return isActive(reading) && Date.parse(reading.due) <= now.getTime();
}

export function wordCounts(
	occurrences: Map<LexemeId, number>,
	lines: Map<LexemeId, number>,
	states: Map<LexemeId, WordState>,
	memory: Map<LexemeId, Partial<Record<Skill, Memory>>>,
	now: Date,
	parameters?: FsrsParameters
): WordCounts {
	const counts: WordCounts = { due: 0, dueOccurrences: 0, fresh: 0, freshRecurring: 0 };
	for (const [lexeme, n] of occurrences) {
		const reading = memory.get(lexeme)?.reading;
		const kind = kindOf(states.get(lexeme)?.state, reading, now, parameters);
		if (kind === 'ignored') continue;
		if (isDueWord(states.get(lexeme)?.state, reading, now, parameters)) {
			counts.due++;
			counts.dueOccurrences += n;
		}
		if (kind === 'fresh') {
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
 * 0, and a word with no memory but a known mark (an old one) 1, as the shares bar counts it.
 */
export function understood(
	occurrences: Map<LexemeId, number>,
	states: Map<LexemeId, WordState>,
	memory: Map<LexemeId, Partial<Record<Skill, Memory>>>,
	now: Date,
	parameters?: FsrsParameters,
	noise: Noise = { falseSuccess: 0, falseFailure: 0 }
): number | undefined {
	let sum = 0;
	let total = 0;
	for (const [lexeme, n] of occurrences) {
		const reading = memory.get(lexeme)?.reading;
		const kind = kindOf(states.get(lexeme)?.state, reading, now, parameters);
		if (kind === 'ignored') continue;
		const chance = reading
			? noise.falseSuccess +
				(1 - noise.falseSuccess - noise.falseFailure) * recall(reading, now, parameters)
			: kind === 'known'
				? 1
				: 0;
		sum += n * chance;
		total += n;
	}
	return total === 0 ? undefined : sum / total;
}

/** Fractions summing to 1, or undefined for a document with no counted words. */
export function textShares(
	occurrences: Map<LexemeId, number>,
	states: Map<LexemeId, WordState>,
	memory: Map<LexemeId, Partial<Record<Skill, Memory>>>,
	now: Date,
	parameters?: FsrsParameters
): Shares | undefined {
	const counts: Shares = { known: 0, learning: 0, fresh: 0 };
	for (const [lexeme, n] of occurrences) {
		const kind = kindOf(states.get(lexeme)?.state, memory.get(lexeme)?.reading, now, parameters);
		if (kind !== 'ignored') counts[kind] += n;
	}
	const total = counts.known + counts.learning + counts.fresh;
	if (total === 0) return undefined;
	return {
		known: counts.known / total,
		learning: counts.learning / total,
		fresh: counts.fresh / total
	};
}
