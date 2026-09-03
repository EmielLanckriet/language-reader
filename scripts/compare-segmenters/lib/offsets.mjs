// Code-point offset helpers.
//
// This is a plain reimplementation of `src/lib/domain/offsets.ts` for a plain-.mjs harness that
// cannot import TypeScript with extensionless specifiers. It is duplicated on purpose rather than
// built via a build step, because this script must run with nothing beyond Node itself — see the
// README for why that duplication is a named risk rather than an oversight.
//
// The reason it exists at all: every offset this harness reports must be a Unicode code-point
// index, never a UTF-16 code unit index. `Intl.Segmenter` reports the latter. On text made only of
// BMP characters the two agree, which is exactly what makes the distinction easy to miss — see
// `codePointIndexMap` below and its use in `candidates/intl-segmenter.mjs`.

/** Split text into its characters (code points, not UTF-16 code units). */
export function codePointsOf(text) {
	return [...text];
}

/** How many characters the text contains, which is not always `text.length`. */
export function codePointLength(text) {
	return codePointsOf(text).length;
}

/**
 * A lookup from UTF-16 code unit index to character (code point) index, for the whole of `text`.
 *
 * `Intl.Segmenter` reports positions as UTF-16 code unit indices. Converting is not optional: for
 * text made only of BMP characters the two indices are identical, so an unconverted offset passes
 * every ordinary test and only breaks the first time a character outside the BMP appears (research.md
 * R2 in the main spec: 𠮷野家很好 is five characters in six UTF-16 units).
 *
 * The map has one entry per code unit plus one, so a token's exclusive end offset — which may sit
 * one past the last character — converts like any other position.
 */
export function codePointIndexMap(text) {
	const map = new Array(text.length + 1);

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
