/**
 * Splitting text into the units a segmenter is allowed to see at once (ADR-0013).
 *
 * A word never spans a subtitle line or a sentence end, so a segmenter that can propose one is
 * being given the opportunity to make an error it can never be right about. Bounding the unit
 * removes the opportunity. It also bounds the work per call, though that turned out not to matter:
 * measured, segmenting 5,000 characters takes under 4 ms either way.
 *
 * **The rule is language-neutral; the delimiter set is not.** What can appear inside a word is a
 * fact about a language, so the set belongs to the language provider and arrives here as an
 * argument. Chinese excludes the ASCII full stop, because there it lives inside numbers,
 * abbreviations and URLs rather than ending sentences. Dutch depends on it as the terminator. This
 * function must have no opinion about either.
 *
 * Nothing is discarded: delimiters stay in the unit they close, so units concatenate back to the
 * source. That is what makes a wrong delimiter set a loud failure rather than a quiet one — the
 * whole-document tiling property fails, instead of a word being silently split.
 */

import { codePointsOf } from '../domain/offsets';

export interface SegmentationUnit {
	/** Character offset of this unit's first character within the whole text. */
	start: number;
	text: string;
}

export function splitIntoUnits(text: string, delimiters: ReadonlySet<string>): SegmentationUnit[] {
	const characters = codePointsOf(text);
	const units: SegmentationUnit[] = [];

	let start = 0;
	let current = '';

	for (const character of characters) {
		current += character;

		// The delimiter closes the unit it ends rather than starting the next one, so that a
		// sentence keeps its own full stop and no character has to be stored separately.
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
