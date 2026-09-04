/**
 * Catching up the documents the reader has not opened (FR-016).
 *
 * Opening a document no longer re-derives it merely because it is out of date — that cost thirty
 * seconds and failed SC-004 (research.md R18) — so this is the **only** thing that improves a
 * readable document. Everything about it is shaped by that responsibility and by one measurement:
 * the model costs about 4 s per 1,000 characters, which is longer than a phone reliably stays in
 * the foreground.
 *
 * Four obligations, and each of them is a way of not being harmful:
 *
 * 1. **Yield to the reader** (FR-018). A batch at a time, with a real task boundary inside each one
 *    (see `upgrade.ts`), so the main thread is never held. The awaits alone used to look like this
 *    and were not: research.md R20.
 * 2. **Keep what it has done** (FR-021). Every batch is durable when it lands, so losing visibility
 *    part-way through a document costs one batch rather than the whole pass. This is why documents
 *    stayed on the dictionary forever before ADR-0016 — a 27-second pass on a phone is a pass that
 *    usually does not finish.
 * 3. **Do not run without the lease** (FR-019). A copy that cannot write must not try. The worker
 *    refuses the write anyway, but a sweep that keeps asking keeps contending.
 * 4. **Fail soft** (FR-027). A document that will not upgrade is left as it is and the sweep moves
 *    on. It must not spin, and it must not take the rest of the library down with it.
 */

import type { Analyzer } from '../analyzer/types';
import { stampOf } from '../analyzer/resolve';
import type { StoredDocument, UpgradeBatch } from './repository';
import { codePointsOf } from '../domain/offsets';
import { isStale } from './rederive';
import { nextBatch, upgradeStart, type BatchOptions } from './upgrade';

/** Long enough that the reader's own work always wins, short enough to finish a library quickly. */
const PAUSE_BETWEEN_BATCHES_MS = 150;

/**
 * The part of storage a sweep uses.
 *
 * Narrow deliberately. It says what the sweep is permitted to touch — no marks, no history, no
 * document text beyond reading it — and it is what makes the sweep testable against a fake without
 * a worker.
 */
export interface SweepStorage {
	staleDocumentIds(analyzerName: string, analyzerVersion: string): Promise<number[]>;
	getDocument(id: number): Promise<StoredDocument>;
	advanceUpgrade(
		documentId: number,
		batch: UpgradeBatch,
		upgrade: AnalyzerStampLike
	): Promise<void>;
}

type AnalyzerStampLike = { name: string; version: string };

export interface SweepOutcome {
	/** Documents brought fully up to date. */
	rederived: number;
	/** Instalments written, including those of documents the sweep did not get to finish. */
	batches: number;
	failed: number;
}

/** Told after every batch that lands, so a document on screen can show the improvement (FR-016). */
export type OnAdvance = (documentId: number, through: number, of: number) => void;

export interface SweepOptions {
	/** Reported so a failure is discoverable rather than invisible (FR-022). */
	onFailure?: (documentId: number, error: unknown) => void;
	onAdvance?: OnAdvance;
	/**
	 * Which document to do next, if it is still stale — the one the reader is looking at.
	 *
	 * Asked before every document rather than once, because the reader opens things while the sweep
	 * runs. Without it the sweep works in id order, and a reader who opens the newest document in a
	 * library of five waits for the other four before the words in front of them improve. Which is
	 * indistinguishable, from where they are sitting, from the upgrade not working at all.
	 */
	prefer?: () => number | undefined;
	/** How a batch is bounded. Passed through so a test can drive it without waiting for it. */
	batch?: BatchOptions;
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Bring every stale document up to date, a batch at a time.
 *
 * `shouldContinue` is asked before every **batch**, not merely before every document. That is the
 * change ADR-0016 is for: a document takes half a minute, a phone gives you a few seconds, and
 * asking only between documents meant the answer arrived long after it mattered.
 */
export async function sweepStaleDocuments(
	client: SweepStorage,
	analyzer: Analyzer,
	shouldContinue: () => boolean,
	options: SweepOptions = {}
): Promise<SweepOutcome> {
	const outcome: SweepOutcome = { rederived: 0, batches: 0, failed: 0 };

	if (!shouldContinue()) return outcome;

	// Asked once. A document imported during the sweep is already current, and one that becomes
	// stale later is picked up by the next sweep rather than by extending this one indefinitely.
	let stale: number[];
	try {
		stale = await client.staleDocumentIds(analyzer.name, analyzer.version);
	} catch {
		// Storage is not available to this copy. That is the ordinary case for a background copy,
		// not an error worth reporting.
		return outcome;
	}

	const remaining = new Set(stale);

	while (remaining.size > 0) {
		if (!shouldContinue()) break;

		const preferred = options.prefer?.();
		const documentId =
			preferred !== undefined && remaining.has(preferred)
				? preferred
				: (remaining.values().next().value as number);
		remaining.delete(documentId);

		try {
			if (
				await upgradeOneDocument(client, documentId, analyzer, shouldContinue, options, outcome)
			) {
				outcome.rederived += 1;
			}
		} catch (error) {
			// Left where it is, deliberately: partly upgraded is a safe resting state — the boundary
			// says exactly how far it got — and the next sweep will try again. Reported so it is
			// discoverable rather than invisible (FR-022).
			outcome.failed += 1;
			options.onFailure?.(documentId, error);
		}

		await pause(PAUSE_BETWEEN_BATCHES_MS);
	}

	return outcome;
}

/** Returns true when the document reached the analyzer in force. */
async function upgradeOneDocument(
	client: SweepStorage,
	documentId: number,
	analyzer: Analyzer,
	shouldContinue: () => boolean,
	options: SweepOptions,
	outcome: SweepOutcome
): Promise<boolean> {
	while (shouldContinue()) {
		// Re-read every batch rather than tracking the boundary here. It costs one read of text the
		// reader has already stored, and it means the plan is made from what is actually recorded —
		// including if something else moved the document along in between.
		const document = await client.getDocument(documentId);
		if (!isStale(document, analyzer)) return true;

		const batch = await nextBatch(
			document,
			analyzer,
			upgradeStart(document, analyzer),
			options.batch
		);
		if (batch === undefined) return true;

		await client.advanceUpgrade(documentId, batch, stampOf(analyzer));
		outcome.batches += 1;
		options.onAdvance?.(documentId, batch.through, codePointsOf(document.rawContent).length);

		if (batch.through === codePointsOf(document.rawContent).length) return true;
		await pause(PAUSE_BETWEEN_BATCHES_MS);
	}

	return false;
}
