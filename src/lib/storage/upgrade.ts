/**
 * Upgrading a document to a better analyzer in instalments (ADR-0016).
 *
 * The contextual model costs about 4 s per 1,000 characters (research.md R18), so a document is not
 * something that can be re-derived between one moment of the reader's attention and the next. This
 * splits the work into batches that are durable when they land, and — just as importantly — lets go
 * of the main thread between them.
 *
 * **The yield is the whole point, and it is not the `await`.** `taggedAnalyzer.analyze` already
 * awaited every chunk, which looked like small pieces of work and was one long one: `await`
 * schedules a microtask, and a browser paints and answers taps between *tasks*. So a 27-second pass
 * ran to completion without a single frame, and the reader's phone had every reason to think the
 * page had hung. `yieldToBrowser` below is a real task boundary. Measured, and kept measurable, in
 * `scripts/measure/yield.mjs`.
 *
 * Batches end on segmentation-unit boundaries (ADR-0013) because that is what makes the recorded
 * boundary meaningful: no token may span a unit, so no token can straddle the line between what has
 * been upgraded and what has not.
 */

import type { Analyzer, AnalyzedToken } from '../analyzer/types';
import { resolveTokens } from '../analyzer/resolve';
import { splitIntoUnits } from '../analyzer/units';
import { codePointsOf } from '../domain/offsets';
import type { StoredDocument, UpgradeBatch } from './repository';

/**
 * How long a batch may spend before stopping at the next unit boundary.
 *
 * Measured in elapsed time rather than counted in characters, because the phone is the oracle and
 * how fast it segments is not knowable here — it depends on the device, the model, and what else
 * the browser is doing. Five seconds is the reader's own number: long enough that the writes are
 * infrequent, short enough that losing a batch to a locked phone costs little.
 */
export const BATCH_BUDGET_MS = 5000;

/** Where an upgrade of this document should start, and how far it must go before it may stop. */
export interface UpgradePlan {
	from: number;
	/**
	 * A batch may not stop before here.
	 *
	 * Zero in the ordinary case. It matters only when a *different* analyzer had already upgraded
	 * part of this document: that prefix must be entirely overwritten, because otherwise the tokens
	 * between the new boundary and the old one would be claimed for the document's stamp while
	 * having come from an analyzer nobody is using any more (ADR-0016).
	 */
	atLeast: number;
}

export function upgradeStart(document: StoredDocument, analyzer: Analyzer): UpgradePlan {
	const recorded = document.upgrade;

	if (
		recorded !== undefined &&
		recorded.analyzer === analyzer.name &&
		recorded.version === analyzer.version
	) {
		return { from: recorded.through, atLeast: recorded.through };
	}

	return { from: 0, atLeast: recorded?.through ?? 0 };
}

export interface BatchOptions {
	budgetMs?: number;
	/** Injected so tests can drive the budget without waiting for it. */
	now?: () => number;
	/** Injected so tests can observe that a real task boundary is taken, not merely an `await`. */
	yieldToBrowser?: () => Promise<void>;
}

/** A real task boundary: the browser gets to paint, and to answer the reader. */
function taskBoundary(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Analyse the next stretch of a document, stopping at the first unit boundary past the budget.
 *
 * Returns `undefined` when the plan starts at the end of the document, which is how a caller learns
 * there is nothing left to do.
 *
 * Each unit is analysed **on its own** rather than by analysing the document and taking a slice.
 * That is what makes resuming possible at all, and it gives the same answer only because units are
 * exactly the stretches an analyzer is allowed to see at once (ADR-0013) — a property worth stating
 * because it is the one that would break silently if the delimiter sets of two analyzers diverged.
 */
export async function nextBatch(
	document: StoredDocument,
	analyzer: Analyzer,
	plan: UpgradePlan,
	options: BatchOptions = {}
): Promise<UpgradeBatch | undefined> {
	const budgetMs = options.budgetMs ?? BATCH_BUDGET_MS;
	const now = options.now ?? (() => Date.now());
	const yieldToBrowser = options.yieldToBrowser ?? taskBoundary;

	const units = splitIntoUnits(document.rawContent, analyzer.unitDelimiters);
	const remaining = units.filter((unit) => unit.start >= plan.from);

	if (remaining.length === 0) return undefined;
	if (remaining[0].start !== plan.from) {
		// Only reachable if a boundary was recorded that no analyzer would have produced. Loud,
		// because carrying on would analyse from the wrong place and store the result.
		throw new Error(
			`An upgrade of document ${document.id} would resume at ${plan.from}, which is not a segmentation-unit boundary.`
		);
	}

	const analyzed: AnalyzedToken[] = [];
	let through = plan.from;
	const started = now();

	for (const unit of remaining) {
		const tokens = await analyzer.analyze(unit.text);
		for (const token of tokens) {
			analyzed.push({
				start: token.start + unit.start,
				end: token.end + unit.start,
				isWord: token.isWord
			});
		}
		through = unit.start + codePointsOf(unit.text).length;

		await yieldToBrowser();
		if (through >= plan.atLeast && now() - started >= budgetMs) break;
	}

	return {
		from: plan.from,
		through,
		tokens: resolveTokens(document.rawContent, analyzed, analyzer)
	};
}
