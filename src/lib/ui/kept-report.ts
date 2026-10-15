import type { TuningReport } from '$lib/domain/tuning';

/**
 * Learning data's last report, kept so the page opens with it at once while a fresh one is computed
 * behind it (Principle VIII): building the report reads every word's history, 16 s on the A71 for
 * 2,191 words (2026-10-15). Derived and small (2.6 KB), so `localStorage`; lost or unreadable, the
 * page waits for the fresh report as before. Bump SHAPE when `TuningReport` changes shape.
 */
const KEY = 'learning-data-report';
const SHAPE = 1;

export interface KeptReport {
	at: string;
	report: TuningReport;
}

export function keptReport(): KeptReport | null {
	try {
		const kept = JSON.parse(localStorage.getItem(KEY) ?? 'null');
		return kept?.shape === SHAPE && kept.report ? { at: kept.at, report: kept.report } : null;
	} catch {
		return null;
	}
}

export function keepReport(report: TuningReport, at = new Date()): void {
	try {
		localStorage.setItem(KEY, JSON.stringify({ shape: SHAPE, at: at.toISOString(), report }));
	} catch {
		// Storage refused: the next visit waits for the report, as before.
	}
}
