import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { checkTiling, tiles } from '../../src/lib/domain/tiling';
import { characterSplitter } from '../../src/lib/analyzer/character';
import { codePointLength } from '../../src/lib/domain/offsets';

// FR-005 and invariant 1 of data-model.md.
//
// **Never assert an expected segmentation.** Word-hood in Chinese is undefined and
// analyzer-dependent: reasonable people disagree about 北京大学, and every analyzer upgrade would
// break a test that encoded one opinion. What is actually true of *every* analyzer, forever, is
// that its tokens tile the document — ordered, non-overlapping, gapless, and reassembling to the
// source exactly. That is what is asserted here (Constitution Principle II).

const EXT_B = '\u{2000B}'; // 𠀋 — one character, two UTF-16 code units
const EMOJI = '\u{1F600}';

const ALPHABET = ['我', '们', '看', '书', 'a', 'B', '7', '，', '。', ' ', '\n', EXT_B, EMOJI];

const anyText = fc.array(fc.constantFrom(...ALPHABET), { maxLength: 80 }).map((cs) => cs.join(''));

describe('the tiling invariant', () => {
	describe('as a check on any analyzer', () => {
		it('accepts a correct tiling', () => {
			expect(
				checkTiling(
					[
						{ start: 0, end: 1 },
						{ start: 1, end: 3 }
					],
					'你好吗'
				)
			).toEqual([]);
			expect(tiles([{ start: 0, end: 3 }], '你好吗')).toBe(true);
		});

		it('accepts no tokens for empty text', () => {
			expect(checkTiling([], '')).toEqual([]);
		});

		it('rejects a gap', () => {
			expect(
				checkTiling(
					[
						{ start: 0, end: 1 },
						{ start: 2, end: 3 }
					],
					'你好吗'
				)
			).not.toEqual([]);
		});

		it('rejects an overlap', () => {
			expect(
				checkTiling(
					[
						{ start: 0, end: 2 },
						{ start: 1, end: 3 }
					],
					'你好吗'
				)
			).not.toEqual([]);
		});

		it('rejects tokens out of order', () => {
			expect(
				checkTiling(
					[
						{ start: 1, end: 3 },
						{ start: 0, end: 1 }
					],
					'你好吗'
				)
			).not.toEqual([]);
		});

		it('rejects an empty span', () => {
			expect(
				checkTiling(
					[
						{ start: 0, end: 0 },
						{ start: 0, end: 3 }
					],
					'你好吗'
				)
			).not.toEqual([]);
		});

		it('rejects stopping short of the end', () => {
			expect(checkTiling([{ start: 0, end: 2 }], '你好吗')).not.toEqual([]);
		});

		it('rejects running past the end', () => {
			expect(checkTiling([{ start: 0, end: 9 }], '你好吗')).not.toEqual([]);
		});

		it('rejects tokens for text that has none', () => {
			expect(checkTiling([{ start: 0, end: 1 }], '')).not.toEqual([]);
		});

		it('measures the end in characters, not UTF-16 code units', () => {
			// The string is 2 characters and 4 code units. An implementation that used .length
			// would demand a token ending at 4 and reject this correct tiling.
			const text = `${EXT_B}${EMOJI}`;
			expect(checkTiling([{ start: 0, end: 2 }], text)).toEqual([]);
			expect(text.length).toBe(4);
		});
	});

	describe('as a property of the slice-0 analyzer', () => {
		it('tiles any text exactly', async () => {
			await fc.assert(
				fc.asyncProperty(anyText, async (text) => {
					const tokens = await characterSplitter.analyze(text);
					expect(checkTiling(tokens, text)).toEqual([]);
				})
			);
		});

		it('reassembles any text from its tokens', async () => {
			await fc.assert(
				fc.asyncProperty(anyText, async (text) => {
					const tokens = await characterSplitter.analyze(text);
					const characters = [...text];
					const rebuilt = tokens.map((t) => characters.slice(t.start, t.end).join('')).join('');
					expect(rebuilt).toBe(text);
				})
			);
		});

		it('produces no tokens for empty input, rather than failing', async () => {
			expect(await characterSplitter.analyze('')).toEqual([]);
		});

		it('is deterministic for a fixed name and version', async () => {
			await fc.assert(
				fc.asyncProperty(anyText, async (text) => {
					const once = await characterSplitter.analyze(text);
					const twice = await characterSplitter.analyze(text);
					expect(twice).toEqual(once);
				})
			);
		});

		it('is honest about which tokens are markable', async () => {
			const tokens = await characterSplitter.analyze('我看a，\n书');
			const marked = tokens.filter((t) => t.isWord).length;
			// Hanzi are markable; Latin letters, punctuation and whitespace are tiled but not.
			// Asserted as a count rather than a segmentation: this is about isWord being honest,
			// not about where the analyzer chose to cut.
			expect(marked).toBe(3);
		});

		it('identifies itself, so its output can be re-derived later (FR-003)', () => {
			expect(characterSplitter.name).toBe('character-splitter');
			expect(characterSplitter.version).toBe('1');
			expect(characterSplitter.language).toBe('zh');
		});

		it('emits one token per character', async () => {
			await fc.assert(
				fc.asyncProperty(anyText, async (text) => {
					const tokens = await characterSplitter.analyze(text);
					expect(tokens.length).toBe(codePointLength(text));
				})
			);
		});
	});
});
