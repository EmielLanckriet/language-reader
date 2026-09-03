/**
 * Catching up the documents the reader has not opened (FR-016).
 *
 * Opening a stale document re-derives it immediately, so the reader never sees placeholder tokens
 * in anything they look at. That alone would leave the rest of the library stale indefinitely,
 * which is not wrong so much as untidy — and it would mean the analyzer swap was never really
 * finished. This finishes it, without anyone waiting.
 *
 * Three obligations shape everything here, and each of them is a way of not being harmful:
 *
 * 1. **Yield to the reader** (FR-018). One document at a time, with a real pause between them, so
 *    the main thread is never held for longer than a single small transaction.
 * 2. **Do not run without the lease** (FR-019). A copy that cannot write must not try. The worker
 *    refuses the write anyway, but a sweep that keeps asking is a sweep that keeps contending, and
 *    slice 1 was about not letting two copies fight over storage.
 * 3. **Fail soft** (FR-027). A document that will not re-derive is left stale and the sweep moves
 *    on. It will be retried next time. It must not spin, and it must not take the rest of the
 *    library down with it.
 */

import type { Analyzer } from '../analyzer/types';
import type { RepositoryClient } from './client';
import { rederiveDocument } from './rederive';

/** Long enough that the reader's own work always wins, short enough to finish a library quickly. */
const PAUSE_BETWEEN_DOCUMENTS_MS = 150;

export interface SweepOutcome {
	rederived: number;
	failed: number;
}

function pause(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Re-derive every stale document, one at a time.
 *
 * `shouldContinue` is asked before each document rather than once at the start: the reader may open
 * something, or this copy may lose the lease, at any point during a sweep that takes a while.
 */
export async function sweepStaleDocuments(
	client: RepositoryClient,
	analyzer: Analyzer,
	shouldContinue: () => boolean,
	onFailure?: (documentId: number, error: unknown) => void
): Promise<SweepOutcome> {
	const outcome: SweepOutcome = { rederived: 0, failed: 0 };

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

	for (const documentId of stale) {
		if (!shouldContinue()) break;

		try {
			const document = await client.getDocument(documentId);
			await rederiveDocument(client, document, analyzer);
			outcome.rederived += 1;
		} catch (error) {
			// Left stale deliberately: stale is a safe resting state, and the next open or the next
			// sweep will try again. Reported so it is discoverable rather than invisible (FR-022).
			outcome.failed += 1;
			onFailure?.(documentId, error);
		}

		await pause(PAUSE_BETWEEN_DOCUMENTS_MS);
	}

	return outcome;
}
