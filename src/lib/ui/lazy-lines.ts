/**
 * A media document's lines, each built when it is shown (#33).
 *
 * The stage shows one line and the list builds about ten near the screen, but opening a 652-line
 * film built every line's words and pinyin: ~0.47 s of the phone's render, twice (again when the
 * pinyin arrived). Only where each line's tokens start is found up front, as numbers.
 */

/** What the player needs of its lines: plain arrays satisfy it too. */
export interface Lines<T> {
	readonly length: number;
	at(index: number): T | undefined;
}

/**
 * Index of each line's first token, plus one past the last token at the end: line i holds tokens
 * [firsts[i], firsts[i + 1]). A token belongs to the line it starts on; lines are separated by
 * '\n' in the text, and an empty line holds no token.
 */
export function lineFirsts(tokens: readonly { start: number }[], characters: readonly string[]) {
	const firsts = [0];
	let offset = 0;
	tokens.forEach((token, k) => {
		while (offset < token.start) if (characters[offset++] === '\n') firsts.push(k);
	});
	firsts.push(tokens.length);
	return firsts;
}

/** `length` lines, line i made by `build(i)` the first time it is asked for. */
export function lazyLines<T>(length: number, build: (index: number) => T): Lines<T> {
	const built = new Map<number, T>();
	return {
		length,
		at(index) {
			if (index < 0 || index >= length) return undefined;
			let line = built.get(index);
			if (line === undefined) built.set(index, (line = build(index)));
			return line;
		}
	};
}
