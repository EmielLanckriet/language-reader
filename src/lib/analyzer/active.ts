/**
 * The one place that names the analyzer currently in use.
 *
 * Slice 0 imported its analyzer directly at the single call site that needed it, which was right
 * while one analyzer existed and one path used it. Slice 2 has two callers — importing a document
 * and re-deriving an existing one — and they must agree. If they ever disagreed, documents would be
 * stamped with one analyzer and tokenised by another, which is exactly the inconsistency the stamp
 * exists to make impossible.
 *
 * This is not a registry, a plugin system, or a new seam. It removes a duplicated choice. Swapping
 * analyzers is editing this file, and every document stamped by the previous one becomes stale and
 * re-derives on its own.
 *
 * **Why the dictionary and not the platform.** `Intl.Segmenter` was chosen first because it is
 * correct enough and costs nothing, and it was then measured wrong on the only device that matters:
 * Chrome on the reader's Android phone carries no CJK dictionary and returns one token per
 * character (research.md R11). `chinese.ts` stays in the codebase — it is what the comparison
 * harness measures against, and what a device with a complete ICU would use if that ever became
 * worth doing — but it is not what the reader reads with.
 */

import type { Analyzer } from './types';
import { dictionaryAnalyzer } from './dictionary';
import { wordList } from './wordlist';

export const activeAnalyzer: Analyzer = dictionaryAnalyzer(wordList);
