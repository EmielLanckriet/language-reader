/**
 * The one place in this application where a string is measured or sliced by position.
 *
 * Every stored position is an offset in **Unicode code points** into a document's retained raw
 * content (FR-014). JavaScript's own `.length` and `.slice()` count UTF-16 code units instead, and
 * the two agree for almost all Chinese text — which is precisely what makes disagreeing dangerous.
 * A rare character such as 𠀋 (Extension B) is one character and two code units, so a document
 * containing one shifts every offset after it. The marks still load, they just land on the wrong
 * words, silently, long after they were made.
 *
 * Code points rather than grapheme clusters, deliberately: an export must agree with whatever
 * reads it, and a Python program counting `len(s)` counts code points.
 */

/**
 * Split text into its characters.
 *
 * For bulk work — tiling a document, rendering every token — call this **once** and index the
 * result, rather than calling `sliceByCodePoints` per token. Each call walks the whole string.
 */
export function codePointsOf(text: string): string[] {
	return [...text];
}

/** How many characters the text contains, which is not always `text.length`. */
export function codePointLength(text: string): number {
	return codePointsOf(text).length;
}

/**
 * The characters from `start` (inclusive) to `end` (exclusive).
 *
 * Boundaries are character boundaries, so a surrogate pair is never split in half.
 */
export function sliceByCodePoints(text: string, start: number, end: number): string {
	return codePointsOf(text).slice(start, end).join('');
}
