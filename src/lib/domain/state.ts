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
 * Marks are Anki's levels only (spec 019, ADR-0044): the reader's own states (unknown, learning,
 * known, ignored, retired) were deleted at the switch to statuses, which live in their own table.
 * A mark name is free text, so a new kind of mark is data, not a migration; **renaming one is not
 * cheap**: it silently reinterprets every mark already made under the old name.
 */
/** Anki's own levels for a word imported from the reader's collection (ADR-0024): only an import writes them. */
export const ANKI_LEVELS: StateDefinition[] = [
	{ name: 'anki-learning', label: 'Anki: learning' },
	{ name: 'anki-young', label: 'Anki: young' },
	{ name: 'anki-mature', label: 'Anki: mature' },
	{ name: 'anki-long-term', label: 'Anki: long-term' }
];

/**
 * The one assertion that is not a state: "never judged" again. Undoing an import writes it for a
 * word the import marked from nothing, since the history is append-only and cannot lose the event.
 */
export const RETRACTED = '(none)';

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
		if (entry.asserted === RETRACTED) {
			states.delete(entry.lexemeId);
			continue;
		}
		states.set(entry.lexemeId, {
			lexemeId: entry.lexemeId,
			state: entry.asserted,
			provenance: entry.provenance,
			userId: entry.userId
		});
	}

	return states;
}
