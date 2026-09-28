import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { lines, toVtt, LONGEST, PAUSE } from '../../src/lib/speech/lines';
import { parseSubtitles } from '../../src/lib/media/subtitles';
import type { Token } from '../../src/lib/speech/windows';

/** Tokens with non-decreasing times, mostly single characters as SenseVoice writes Chinese. */
const tokens = fc
	.array(
		fc.record({
			text: fc.oneof(
				{ weight: 9, arbitrary: fc.constantFrom('我', '们', '花', '钱', '吗', '学') },
				fc.constant(' k')
			),
			// Mostly short gaps, so runs longer than a line without a pause are common: splitting them
			// is the case a test of this could miss.
			gap: fc.oneof(
				{ weight: 12, arbitrary: fc.double({ min: 0.06, max: 0.3, noNaN: true }) },
				{ weight: 1, arbitrary: fc.double({ min: 0.3, max: 3, noNaN: true }) }
			)
		}),
		{ maxLength: 300, size: 'max' }
	)
	.map((xs) => {
		let t = 0;
		return xs.map(({ text, gap }): Token => [text, (t += gap)]);
	});

describe('cutting tokens into lines', () => {
	it('puts every token in exactly one line, in order', () => {
		fc.assert(
			fc.property(tokens, (ts) => {
				expect(lines(ts).flatMap((l) => l.tokens)).toEqual(ts);
			})
		);
	});

	it('keeps lines short and starts a new one at every long pause', () => {
		fc.assert(
			fc.property(tokens, (ts) => {
				const ls = lines(ts);
				for (const l of ls) {
					expect(l.tokens.map(([x]) => x).join('').length).toBeLessThanOrEqual(LONGEST);
					for (let i = 1; i < l.tokens.length; i++)
						expect(l.tokens[i][1] - l.tokens[i - 1][1]).toBeLessThan(PAUSE);
				}
			})
		);
	});

	it('times each line from its first token, ending before the next begins', () => {
		fc.assert(
			fc.property(tokens, (ts) => {
				const ls = lines(ts);
				ls.forEach((l, i) => {
					expect(l.from).toBe(l.tokens[0][1]);
					expect(l.to).toBeGreaterThan(l.from);
					if (i + 1 < ls.length) expect(l.to).toBeLessThanOrEqual(ls[i + 1].from);
				});
			})
		);
	});

	it('writes WebVTT that Reader reads back as the same lines', () => {
		fc.assert(
			fc.property(tokens, (ts) => {
				// The parser drops a line equal to the one before it (YouTube's rolling captions).
				const ls = lines(ts).filter((l, i, all) => l.text !== '' && l.text !== all[i - 1]?.text);
				const cues = parseSubtitles(toVtt(lines(ts)));
				expect(cues.map((c) => c.text)).toEqual(ls.map((l) => l.text));
				cues.forEach((c, i) => expect(Math.abs(c.start - ls[i].from)).toBeLessThanOrEqual(0.001));
			})
		);
	});
});
