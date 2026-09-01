/**
 * Building and ordering entries in the permanent history.
 *
 * The history is append-only: never updated, never deleted (FR-010). There is deliberately no
 * function here that modifies an entry, and no interface method anywhere that deletes one.
 */

import {
	MANUAL,
	type HistoryEntry,
	type LexemeId,
	type Occurrence,
	type Provenance
} from './types';

/** The single local reader. FR-013's hedge, defaulted rather than absent. */
export const LOCAL_USER = 1;

export interface Assertion {
	lexemeId: LexemeId;
	/** What the reader claimed — not what the state became (FR-010a). */
	asserted: string;
	deviceId: string;
	deviceSeq: number;
	assertedAt: string;
	occurrence?: Occurrence;
	provenance?: Provenance;
	userId?: number;
}

/**
 * Construct one entry.
 *
 * Note what this function cannot produce: an entry saying a word's state *became* something.
 * There is no such field. An entry is a record of a claim at a moment, and the claim is all it
 * has — which is what lets a future projection reinterpret the whole log without rewriting it.
 */
export function assertion(input: Assertion): HistoryEntry {
	return {
		lexemeId: input.lexemeId,
		asserted: input.asserted,
		assertedAt: input.assertedAt,
		deviceId: input.deviceId,
		deviceSeq: input.deviceSeq,
		provenance: input.provenance ?? MANUAL,
		userId: input.userId ?? LOCAL_USER,
		...(input.occurrence ? { occurrence: input.occurrence } : {})
	};
}

/**
 * Put entries in replay order: by device, then by that device's counter.
 *
 * Within one device this is exact and immune to clock drift, adjustment and time-zone changes.
 * *Across* devices it is merely deterministic — grouping by device id rather than interleaving by
 * time. That is not yet the right answer, and it does not have to be: slice 0 has one device, and
 * when a second appears the interleaving rule can be decided from recorded evidence rather than
 * reconstructed. Deciding it now would be guessing.
 */
export function inHistoryOrder(entries: readonly HistoryEntry[]): HistoryEntry[] {
	return [...entries].sort((a, b) => {
		if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
		return a.deviceSeq - b.deviceSeq;
	});
}
