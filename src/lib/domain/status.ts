/**
 * A word's status (spec 019, ADR-0044): retired, active or ignored, kept apart from its memory.
 *
 * Status changes are earned and append-only; the current status is their replay. A word with no
 * change is retired. Only the reader moves a word out of active or ignored; `activation` is the one
 * rule by which a retired word becomes active, and nothing else may make one.
 */

import type { LexemeId } from './types';

export const STATUSES = ['retired', 'active', 'ignored'] as const;
export type Status = (typeof STATUSES)[number];

/** Why a status changed: a button, the 14-day rule, a budget pick's first review, or the switch. */
export const CAUSES = ['reader', 'stable', 'first-review', 'carried-over'] as const;
export type Cause = (typeof CAUSES)[number];

/** Reading stability, in days, at which a retired word becomes active (ADR-0041, ADR-0044). */
export const ACTIVE_AT_DAYS = 14;

/** Where something sits in the history: what orders it. */
export interface Position {
	deviceId: string;
	deviceSeq: number;
}

export interface StatusChange extends Position {
	lexemeId: LexemeId;
	status: Status;
	cause: Cause;
	/** The device clock, for display only. */
	at: string;
}

export function byPosition(a: Position, b: Position): number {
	if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
	return a.deviceSeq - b.deviceSeq;
}

/** Each word's latest change in history order; a word missing here is retired. */
export function replayStatuses(changes: StatusChange[]): Map<LexemeId, StatusChange> {
	const latest = new Map<LexemeId, StatusChange>();
	for (const change of [...changes].sort(byPosition)) latest.set(change.lexemeId, change);
	return latest;
}

export class InvalidStatusChange extends Error {
	name = 'InvalidStatusChange';
}

/** Refuse a change the contract does not allow (contracts/status-records.md). */
export function validateStatusChange(change: Pick<StatusChange, 'status' | 'cause'>): void {
	if (!STATUSES.includes(change.status))
		throw new InvalidStatusChange(`"${change.status}" is not a status.`);
	if (!CAUSES.includes(change.cause))
		throw new InvalidStatusChange(`"${change.cause}" is not a reason for a status change.`);
	if (change.cause !== 'reader' && change.status !== 'active')
		throw new InvalidStatusChange(`Only the reader makes a word ${change.status}.`);
}

/** The reading memory's stability after one piece of evidence (the Anki seed first, if any). */
export interface ReadingPoint extends Position {
	stability: number;
	/** A review on Cards: not a drill grade, not a tap or a reading. */
	cardReview: boolean;
}

export interface ActivationInput {
	status: Status;
	/** The word's latest status change, if it has one. */
	lastChange?: Position;
	/** The latest change to retired made by the reader, if the current status is one. */
	retiredByReader?: Position;
	/** The switch to statuses: a Cards review before it activates nothing. */
	switchAt: Position;
	/** In history order. */
	trajectory: ReadingPoint[];
}

/**
 * Whether a retired word becomes active, and why (research R3). By stability: some point reaches
 * 14 days; after a hand retire, only a point after it, once the stability had been under 14 since
 * (the stability standing at the retire counts). By a first review: a Cards review after both the
 * word's latest status change and the switch.
 */
export function activation(input: ActivationInput): 'stable' | 'first-review' | undefined {
	if (input.status !== 'retired') return undefined;
	const after = (p: Position, q: Position | undefined) => !q || byPosition(p, q) > 0;

	const retire = input.retiredByReader;
	let armed = true;
	if (retire) {
		const standing = input.trajectory.filter((p) => !after(p, retire)).at(-1);
		armed = !standing || standing.stability < ACTIVE_AT_DAYS;
	}
	for (const point of input.trajectory) {
		if (retire && !after(point, retire)) continue;
		if (point.stability < ACTIVE_AT_DAYS) armed = true;
		else if (armed) return 'stable';
	}

	const reviewed = input.trajectory.some(
		(p) => p.cardReview && after(p, input.lastChange) && after(p, input.switchAt)
	);
	return reviewed ? 'first-review' : undefined;
}
