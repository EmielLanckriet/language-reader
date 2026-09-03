/**
 * Slice 0's analyzer: one token per character.
 *
 * **This is a deliberate placeholder and must not be improved.** A better character splitter would
 * make the slice look more finished while validating nothing extra, and the spec defines that as a
 * defect against this slice's purpose. Real segmentation arrives in slice 1.
 *
 * Its value is that it is the *second* implementation of the language-provider seam, so this slice
 * demonstrates the seam rather than asserting it. It is registered with a name and a version
 * exactly as a real segmenter will be, which is what makes swapping it out a recompute against
 * retained source content rather than a migration (FR-003, FR-004).
 */

import type { Analyzer, AnalyzedToken } from './types';
import { codePointsOf } from '../domain/offsets';

/**
 * Whether a character is one the reader could study.
 *
 * Hanzi only. Punctuation, whitespace, digits and Latin text are tiled — they must be, or the
 * tokens would not reassemble to the document — but they are not markable, because a word list
 * polluted with commas cannot be studied (see Assumptions in the spec).
 *
 * The ranges are CJK Unified Ideographs, its extensions, and the compatibility block.
 */
function isHanzi(character: string): boolean {
	return /\p{Script=Han}/u.test(character);
}

export const characterSplitter: Analyzer = {
	name: 'character-splitter',

	// Still a hand-written constant, and correctly so. ADR-0011 requires a derived version only
	// where the *host* owns the behaviour; this splitter's behaviour is entirely in this file, so it
	// can honestly declare its own version.
	version: '1',

	language: 'zh',

	// One token per character, so no token can span anything: the splitter satisfies the unit rule
	// vacuously. The set is stated rather than left empty because the contract asks every provider
	// to declare one, and because 'this analyzer needs no delimiters' is a claim worth being able to
	// read (ADR-0013).
	unitDelimiters: new Set(),

	analyze(text: string): Promise<AnalyzedToken[]> {
		const tokens = codePointsOf(text).map((character, index) => ({
			start: index,
			end: index + 1,
			isWord: isHanzi(character)
		}));
		return Promise.resolve(tokens);
	},

	// Chinese has no inflection to strip, so slice 0's rule is the identity function. It is stated
	// here rather than assumed by the storage layer because that is the whole point of FR-009:
	// when Dutch arrives wanting dictionary forms, this is the only line that changes.
	lexemeKey(surface: string): string {
		return surface;
	}
};
