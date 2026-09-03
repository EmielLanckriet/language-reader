import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Analyzer } from '../../src/lib/analyzer/types';
import { characterSplitter } from '../../src/lib/analyzer/character';
import { chineseSegmenter } from '../../src/lib/analyzer/chinese';
import { diskAnalyzer } from './support';
import { checkTiling } from '../../src/lib/domain/tiling';
import { codePointLength, sliceByCodePoints, codePointsOf } from '../../src/lib/domain/offsets';

// The obligations every language provider carries
// (specs/003-real-segmentation/contracts/analyzer.md).
//
// Driven by a table on purpose: a contract with one implementation proves nothing, and these must
// hold for the deliberately weak placeholder and the real segmenter alike. When a third analyzer
// arrives it is added here and must pass unchanged.
//
// **Every assertion below is a property.** None compares tokens to an expected segmentation, and
// none may be added that does. Word-hood is analyzer-dependent (ADR-0002), so an expected-value
// test encodes one ICU build's judgment, breaks on the next browser update, and proves nothing
// about correctness in the meantime. This is Constitution Principle II, and it is the rule most
// likely to be broken by a test that looks entirely reasonable.

// Three implementations of one seam. A contract with a single implementation proves nothing, and
// these must hold for the deliberately weak placeholder, the platform segmenter, and the dictionary
// the reader actually reads with.
const ANALYZERS: Analyzer[] = [characterSplitter, chineseSegmenter, diskAnalyzer];

const ALPHABET = [
	'我',
	'在',
	'中',
	'国',
	'学',
	'习',
	'自',
	'行',
	'车',
	'。',
	'！',
	'\n',
	'，',
	' ',
	'a',
	'Z',
	'3',
	'.',
	'\u{20000}' // Extension B: one character, two UTF-16 code units
];
const anyText = fc.array(fc.constantFrom(...ALPHABET), { maxLength: 80 }).map((cs) => cs.join(''));

describe.each(ANALYZERS.map((analyzer) => [analyzer.name, analyzer] as const))(
	'the analyzer contract, as satisfied by %s',
	(_name, analyzer) => {
		it('tiles the whole document exactly', async () => {
			await fc.assert(
				fc.asyncProperty(anyText, async (text) => {
					const tokens = await analyzer.analyze(text);
					// Reusing slice 0's analyzer-agnostic check rather than restating it here.
					expect(checkTiling(tokens, text)).toEqual([]);
				})
			);
		});

		it('reports offsets as character indices, not UTF-16 code unit indices', async () => {
			await fc.assert(
				fc.asyncProperty(anyText, async (text) => {
					const length = codePointLength(text);
					for (const token of await analyzer.analyze(text)) {
						expect(Number.isInteger(token.start)).toBe(true);
						expect(Number.isInteger(token.end)).toBe(true);
						expect(token.start).toBeGreaterThanOrEqual(0);
						expect(token.end).toBeGreaterThan(token.start);
						expect(token.end).toBeLessThanOrEqual(length);
					}
				})
			);
		});

		it('covers every character exactly once', async () => {
			await fc.assert(
				fc.asyncProperty(anyText, async (text) => {
					const covered = new Array<number>(codePointLength(text)).fill(0);
					for (const token of await analyzer.analyze(text)) {
						for (let i = token.start; i < token.end; i++) covered[i] += 1;
					}
					expect(covered.every((count) => count === 1)).toBe(true);
				})
			);
		});

		it('is deterministic for a fixed name and version', async () => {
			await fc.assert(
				fc.asyncProperty(anyText, async (text) => {
					expect(await analyzer.analyze(text)).toEqual(await analyzer.analyze(text));
				})
			);
		});

		it('treats empty input as no tokens, rather than as an error', async () => {
			expect(await analyzer.analyze('')).toEqual([]);
		});

		it('never marks whitespace or punctuation as studiable', async () => {
			await fc.assert(
				fc.asyncProperty(anyText, async (text) => {
					for (const token of await analyzer.analyze(text)) {
						if (!token.isWord) continue;
						const surface = sliceByCodePoints(text, token.start, token.end);
						// isWord means "the reader could study this", which is narrower than the
						// platform's isWordLike: Latin runs and digits are word-like and are not
						// Chinese vocabulary (contracts/analyzer.md obligation 10).
						expect(surface.trim()).not.toBe('');
						expect(/^[\p{P}\p{Z}]+$/u.test(surface)).toBe(false);
						expect(/^[A-Za-z0-9]+$/.test(surface)).toBe(false);
					}
				})
			);
		});

		it('declares a version that is not empty', () => {
			expect(analyzer.version.length).toBeGreaterThan(0);
		});

		it('never proposes a token spanning one of its own unit delimiters', async () => {
			await fc.assert(
				fc.asyncProperty(anyText, async (text) => {
					const characters = codePointsOf(text);
					const swallowed: string[] = [];

					for (const token of await analyzer.analyze(text)) {
						// A delimiter may BE a token; it may never sit inside one.
						for (let i = token.start; i < token.end - 1; i++) {
							if (analyzer.unitDelimiters.has(characters[i])) swallowed.push(characters[i]);
						}
					}

					// Collected and asserted once rather than asserted inside the loop, so that an
					// analyzer whose tokens are all single characters still makes an assertion. A
					// test that quietly asserts nothing is worse than no test: it reports success.
					expect(swallowed).toEqual([]);
				})
			);
		});
	}
);
