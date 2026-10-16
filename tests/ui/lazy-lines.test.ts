import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { lineFirsts, lazyLines } from '../../src/lib/ui/lazy-lines';

// A media document's line i is cue i, and a token belongs to the line it starts on (#33: built when
// shown rather than all at once). The grouping must match the eager one it replaced, token for token.

/** The eager grouping the player used before: the oracle. */
function eager(tokens: { start: number }[], characters: string[]): number[][] {
	const grouped: number[][] = [[]];
	let line = 0;
	let offset = 0;
	tokens.forEach((token, k) => {
		while (offset < token.start) if (characters[offset++] === '\n') grouped[++line] = [];
		grouped[line].push(k);
	});
	return grouped;
}

/** Text of words and line breaks, with a token at each word, as the analyzer would leave them. */
const document = fc
	.array(fc.oneof(fc.constant('\n'), fc.constantFrom('我', '看', '书', '你好', '。')), {
		size: 'max',
		maxLength: 60
	})
	.map((pieces) => {
		const characters: string[] = [];
		const tokens: { start: number }[] = [];
		for (const piece of pieces) {
			if (piece !== '\n') tokens.push({ start: characters.length });
			characters.push(...piece);
		}
		return { characters, tokens };
	});

describe('lines built when shown', () => {
	it('group every token on the line the eager grouping put it on', () => {
		fc.assert(
			fc.property(document, ({ characters, tokens }) => {
				const firsts = lineFirsts(tokens, characters);
				const lines = lazyLines(firsts.length - 1, (i) =>
					Array.from({ length: firsts[i + 1] - firsts[i] }, (_, j) => firsts[i] + j)
				);
				const expected = eager(tokens, characters);
				expect(lines.length).toBe(expected.length);
				expect(Array.from({ length: lines.length }, (_, i) => lines.at(i))).toEqual(expected);
			})
		);
	});

	it('build a line once, and nothing outside them', () => {
		let built = 0;
		const lines = lazyLines(3, (i) => (built++, [i]));
		lines.at(1);
		lines.at(1);
		expect(built).toBe(1);
		expect([lines.at(-1), lines.at(3)]).toEqual([undefined, undefined]);
	});
});
