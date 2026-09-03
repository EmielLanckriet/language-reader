/**
 * The one place that names the analyzer currently in use.
 *
 * Slice 0 imported `characterSplitter` directly at the single call site that needed it, which was
 * right while one analyzer existed and one path used it. Slice 2 has two callers — importing a
 * document and re-deriving an existing one — and they must agree. If they ever disagreed, documents
 * would be stamped with one analyzer and tokenised by another, which is exactly the inconsistency
 * the stamp exists to make impossible.
 *
 * This is not a registry, a plugin system, or a new seam. It removes a duplicated choice. Swapping
 * analyzers is editing this line, and every document stamped by the previous one becomes stale and
 * re-derives on its own.
 */

import type { Analyzer } from './types';
import { chineseSegmenter } from './chinese';

export const activeAnalyzer: Analyzer = chineseSegmenter;
