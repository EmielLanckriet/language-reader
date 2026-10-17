import { expect, it } from 'vitest';
import fc from 'fast-check';
import { firstOccurrences, occurrenceOn } from '../../src/lib/ui/hardcore';
import { lineRangesOf } from '../../src/lib/domain/helped';
import type { Token } from '../../src/lib/domain/types';

// A drill card marks its word's first occurrence in the part, line by line (issue #41: found once
// per part rather than by reading every token for each line of each card).
const segment = fc.oneof(
	fc.record({
		kind: fc.constant('word' as const),
		length: fc.integer({ min: 1, max: 3 }),
		lexemeId: fc.integer({ min: 1, max: 5 }),
		// A word token can cross a line's end, and is then on no line.
		newlineAt: fc.option(fc.integer({ min: 0, max: 2 }), { nil: undefined })
	}),
	fc.constant({ kind: 'newline' as const })
);

it('finds each word’s first occurrence in a part as the line-by-line search does', () => {
	fc.assert(
		fc.property(
			fc.array(segment, { size: 'max', maxLength: 60 }),
			fc.nat(),
			fc.nat(),
			(segments, a, b) => {
				const characters: string[] = [];
				const tokens: Token[] = [];
				for (const s of segments) {
					const start = characters.length;
					if (s.kind === 'newline') {
						characters.push('\n');
						tokens.push({ start, end: start + 1, isWord: false });
						continue;
					}
					for (let i = 0; i < s.length; i++)
						characters.push(s.newlineAt === i && s.length > 1 ? '\n' : 'x');
					tokens.push({ start, end: characters.length, isWord: true, lexemeId: s.lexemeId });
				}
				const ranges = lineRangesOf(characters);
				const first = Math.min(a, b) % ranges.length;
				const lines: [number, number] = [
					first,
					first + (Math.abs(a - b) % (ranges.length - first))
				];
				const found = firstOccurrences(tokens, ranges, lines);
				for (let lexemeId = 1; lexemeId <= 5; lexemeId++) {
					let expected: { token: Token; line: number } | undefined;
					for (let line = lines[0]; line <= lines[1] && !expected; line++) {
						const token = occurrenceOn(tokens, ranges[line], lexemeId);
						if (token) expected = { token, line };
					}
					expect(found.get(lexemeId)).toEqual(expected);
				}
			}
		),
		{ numRuns: 500 }
	);
});
