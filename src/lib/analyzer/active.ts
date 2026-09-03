/**
 * Which analyzer is in force right now.
 *
 * Slice 0 imported its analyzer directly at the one call site that used it. Slice 2 has several
 * callers — importing a document, re-deriving one, the catch-up sweep, the diagnostics view — and
 * they must agree, because stamping a document with one analyzer's name while another produced its
 * tokens is the inconsistency the stamp exists to make impossible.
 *
 * It is a function rather than a constant because the answer changes. The reader may or may not
 * have downloaded the contextual model, and the honest answer depends on whether it is on this
 * device. Resolved per call rather than cached in module state: a `caches.match` is cheap, and a
 * cached answer would go stale exactly when the reader finishes downloading.
 *
 * **The ladder, and why it has these rungs.** `Intl.Segmenter` is not on it at all: it costs
 * nothing and returns one token per character on the reader's phone (research.md R11). The
 * dictionary is always available and gets ordinary words right, and cannot resolve boundaries that
 * depend on context — 你是哪国人 becomes 你 是 哪 国人 under it, and under frequency weighting too.
 * The model resolves those, and costs 98 MB (research.md R13, ADR-0015).
 */

import type { Analyzer } from './types';
import { dictionaryAnalyzer } from './dictionary';
import { wordList } from './wordlist';
import { modelIsStored } from './model-store';

/** Always available, needs no download beyond the install, and is the floor rather than a fallback. */
export const fallbackAnalyzer: Analyzer = dictionaryAnalyzer(wordList);

/**
 * The best analyzer this device can currently run.
 *
 * Imported lazily so that a reader who has never downloaded the model never loads the code that
 * would run it, nor the runtime behind it.
 */
export async function activeAnalyzer(): Promise<Analyzer> {
	if (!(await modelIsStored())) return fallbackAnalyzer;

	try {
		const { bertAnalyzer } = await import('./bert-tagger');
		return bertAnalyzer;
	} catch {
		// The model is stored but the runtime will not load. Reading with the dictionary is better
		// than not reading, and the diagnostics view is where this becomes visible.
		return fallbackAnalyzer;
	}
}
