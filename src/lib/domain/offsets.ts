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

/**
 * A lookup from UTF-16 code unit index to character index, for the whole of `text`.
 *
 * This exists for one reason: `Intl.Segmenter` — and platform text APIs generally — report
 * positions as UTF-16 code unit indices, while every offset this application stores is a character
 * offset. Converting is not optional, and it is not visible when it is missing: for text made only
 * of BMP characters the two indices are identical, so an unconverted offset passes every ordinary
 * test and then mis-anchors the first time a name outside the BMP appears. Offsets recorded against
 * marks are earned data, so that failure is silent and unrecoverable.
 *
 * Returned as a whole map rather than as a per-position function on purpose. A document holds
 * thousands of tokens, and converting each one by walking the string from the start would be
 * quadratic; building the map once is linear. Slice 0 made the same choice in `resolveTokens` for
 * the same reason.
 *
 * The map has one entry per code unit **plus one**, so that a token's exclusive end offset — which
 * may sit one past the last character — converts like any other position. Both halves of a
 * surrogate pair map to the character they belong to, so a mis-reported position inside a pair
 * lands on that character rather than off the end.
 */
export function codePointIndexMap(text: string): number[] {
	const map = new Array<number>(text.length + 1);

	let unit = 0;
	let index = 0;
	for (const character of text) {
		for (let offset = 0; offset < character.length; offset++) {
			map[unit + offset] = index;
		}
		unit += character.length;
		index += 1;
	}
	map[text.length] = index;

	return map;
}
