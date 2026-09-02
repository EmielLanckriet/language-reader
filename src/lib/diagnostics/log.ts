/**
 * The on-device failure record (FR-021).
 *
 * With no server there are no server logs, and Android offers no convenient console — so if a
 * failure is not written here and shown somewhere the reader can reach, it is simply lost, and
 * Principle I makes the phone the place failures are first met. This is why the record exists
 * before there is anything interesting to put in it.
 */

import { queryRows, run, type Database } from '../storage/db';

// The types and `describeError` live in describe.ts, which imports nothing. Anything on the main
// thread must take them from there: importing them from here would reach db.ts and drag SQLite
// along. Re-exported so worker-side callers still read naturally.
export type { Diagnostic, DiagnosticKind } from './describe';
export { describeError } from './describe';

import type { Diagnostic, DiagnosticKind } from './describe';

/**
 * Write a failure down.
 *
 * Never throws. A diagnostics system that can fail while recording a failure turns one problem
 * into two and loses the original, so the fallback is the console — which is useless on a phone,
 * but is strictly better than throwing from a catch block.
 */
export function recordDiagnostic(db: Database, kind: DiagnosticKind, detail: string): void {
	try {
		run(db, 'INSERT INTO diagnostic (at, kind, detail) VALUES (?, ?, ?)', [
			new Date().toISOString(),
			kind,
			detail
		]);
	} catch (error) {
		console.error('[diagnostics] could not record', kind, detail, error);
	}
}

/** Most recent first, because that is the one being investigated. */
export function readDiagnostics(db: Database, limit = 100): Diagnostic[] {
	return queryRows(db, 'SELECT * FROM diagnostic ORDER BY id DESC LIMIT ?', [limit]).map((row) => ({
		id: Number(row.id),
		at: String(row.at),
		kind: String(row.kind),
		detail: String(row.detail)
	}));
}

export function clearDiagnostics(db: Database): void {
	// Diagnostics are derived from failures, not earned by the reader, so clearing them is safe.
	run(db, 'DELETE FROM diagnostic');
}
