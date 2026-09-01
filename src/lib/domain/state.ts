/**
 * The states a word can be in, and the rule turning a history into current states.
 */

import type { HistoryEntry, LexemeId, WordState } from './types';
import { inHistoryOrder } from './history';

export interface StateDefinition {
	/** Stored verbatim in `word_state.state` and in the history. Never renamed casually. */
	name: string;
	/** What the reader sees in the menu. Safe to change; it is not stored. */
	label: string;
}

/**
 * Slice 0's states — **a placeholder, like the analyzer**.
 *
 * This is data, not structure (FR-006a). Adding a state here is the entire change: the column is
 * free text with no enumeration and no check constraint, so nothing migrates. Nothing anywhere may
 * depend on there being exactly four, on these names, or on this order.
 *
 * Whether this product wants discrete states at all, or a numeric familiarity level, is
 * deliberately unsettled. Because current state is a projection (FR-010a), moving to graded levels
 * is a change of fold rather than a change of schema.
 *
 * **Renaming an existing state is not cheap**, and is the one part of the state model that is a
 * one-way door: it silently reinterprets every mark already made under the old name.
 */
export const AVAILABLE_STATES: StateDefinition[] = [
	{ name: 'unknown', label: 'Unknown' },
	{ name: 'learning', label: 'Learning' },
	{ name: 'known', label: 'Known' },
	{ name: 'ignored', label: 'Ignored' }
];

export function stateNames(): string[] {
	return AVAILABLE_STATES.map((state) => state.name);
}

export function isKnownState(name: string): boolean {
	return stateNames().includes(name);
}

/**
 * Fold a history into the current state of every word it mentions.
 *
 * Slice 0's rule is the trivial one (FR-010b): a word's current state is the most recent thing the
 * reader asserted about it. Recency means highest position in the history order, never the latest
 * wall-clock time — a clock that jumps must not reorder the past.
 *
 * **Nothing may depend on this remaining the rule.** Encounter counts arrive with reading sessions
 * and lookups with the dictionary; both become inputs to this function, at which point the fold
 * changes and not one stored entry does. That is the entire reason the history records what was
 * *asserted* rather than what the state *became* (FR-010a).
 *
 * A word appears in the result only if the reader judged it (FR-006b). Words merely read past have
 * no entries, so they get no state — which is different from being 'unknown'.
 */
export function projectStates(entries: readonly HistoryEntry[]): Map<LexemeId, WordState> {
	const states = new Map<LexemeId, WordState>();

	for (const entry of inHistoryOrder(entries)) {
		states.set(entry.lexemeId, {
			lexemeId: entry.lexemeId,
			state: entry.asserted,
			provenance: entry.provenance,
			userId: entry.userId
		});
	}

	return states;
}
