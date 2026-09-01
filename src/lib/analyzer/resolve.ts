/**
 * Turning an analyzer's tokens into something the storage layer can accept.
 *
 * The language provider decides which occurrences count as the same word (FR-009), and it does so
 * as a *function* — which cannot cross a worker boundary. So the rule is applied here, on the side
 * where the provider lives, and the storage layer receives the keys it produced.
 *
 * This is a better separation than passing the analyzer down, not a workaround for one: the
 * repository now holds no reference to a language provider at all, and applies a rule it has no
 * opinion about.
 */

import type { Analyzer, AnalyzedToken } from './types';
import { codePointsOf } from '../domain/offsets';

/** An analyzed token with its word identity already decided. */
export interface ResolvedToken {
	start: number;
	end: number;
	isWord: boolean;
	/** The key its marks accumulate under. Present exactly when `isWord`. */
	lexemeKey?: string;
}

/** Which analyzer produced a document's tokens, recorded so they can be re-derived (FR-003). */
export interface AnalyzerStamp {
	name: string;
	version: string;
}

export function stampOf(analyzer: Analyzer): AnalyzerStamp {
	return { name: analyzer.name, version: analyzer.version };
}

export function resolveTokens(
	text: string,
	tokens: AnalyzedToken[],
	analyzer: Analyzer
): ResolvedToken[] {
	// Converted once rather than per token: slicing a string by code point walks it from the
	// start each time, and a 5,000-character document has 5,000 tokens.
	const characters = codePointsOf(text);

	return tokens.map((token) => ({
		start: token.start,
		end: token.end,
		isWord: token.isWord,
		...(token.isWord
			? { lexemeKey: analyzer.lexemeKey(characters.slice(token.start, token.end).join('')) }
			: {})
	}));
}
