// Splitting text into the units a segmenter is allowed to see at once.
//
// This is a plain reimplementation of `src/lib/analyzer/units.ts` (ADR-0013), duplicated here for
// the same reason as `offsets.mjs`: this harness is plain .mjs and cannot import the application's
// TypeScript. See the README for why that duplication is a named risk.
//
// Every candidate in this harness — not only intl-segmenter — is run one unit at a time, using the
// same Chinese delimiter set the shipped analyzer uses (CHINESE_UNIT_DELIMITERS below, copied from
// `src/lib/analyzer/chinese.ts`). This is a deliberate choice, not an oversight: which characters
// can appear inside a Chinese word is a fact about Chinese, not about which candidate is guessing
// the boundaries, so holding it fixed across candidates keeps the comparison about word
// segmentation rather than about incidental differences in how each candidate handles line breaks
// and sentence punctuation.

import { codePointsOf } from './offsets.mjs';

/**
 * Chinese sentence-final punctuation and line breaks, and nothing else (ADR-0013).
 *
 * Copied from `src/lib/analyzer/chinese.ts`. The ASCII full stop is deliberately excluded: in
 * Chinese text it belongs to 3.14, to U.S., and to example.com rather than to a sentence end.
 */
export const CHINESE_UNIT_DELIMITERS = new Set(['\n', '\r', '。', '！', '？', '…', '；']);

export function splitIntoUnits(text, delimiters) {
	const characters = codePointsOf(text);
	const units = [];

	let start = 0;
	let current = '';

	for (const character of characters) {
		current += character;

		// The delimiter closes the unit it ends rather than starting the next one, so a sentence
		// keeps its own full stop and no character has to be stored separately.
		if (delimiters.has(character)) {
			units.push({ start, text: current });
			start += codePointsOf(current).length;
			current = '';
		}
	}

	// Text that does not end on a delimiter still forms a unit; dropping it would lose the tail.
	if (current.length > 0) {
		units.push({ start, text: current });
	}

	return units;
}
