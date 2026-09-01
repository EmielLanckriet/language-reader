import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { codePointLength, sliceByCodePoints, codePointsOf } from '../../src/lib/domain/offsets';

// Every offset this application stores is a Unicode code point offset into a document's retained
// raw content (FR-014). The obvious way to measure a string in JavaScript gives something else —
// UTF-16 code units — and the two agree for most Chinese text, which is exactly what makes the
// disagreement dangerous. It shows up only on rare characters, silently, long after the marks
// were made. These tests are the reason offsets.ts exists as a module rather than as a habit.

// Extension-B hanzi and emoji are the cases that break naive counting: each is one code point but
// two UTF-16 code units.
const EXT_B = '\u{20000}'; // 𠀀, CJK Extension B
const EXT_B2 = '\u{2000B}'; // 𠀋
const EMOJI = '\u{1F600}'; // 😀

// A deliberately chosen alphabet rather than arbitrary generated text. Lone surrogates are not
// meaningful input here — no content source can produce one — and generating them would test
// JavaScript's string model rather than this application's.
const ALPHABET = [
	'你',
	'好',
	'世',
	'界',
	'a',
	'Z',
	'1',
	'，',
	'。',
	' ',
	'\n',
	EXT_B,
	EXT_B2,
	EMOJI
];

const anyText = fc.array(fc.constantFrom(...ALPHABET), { maxLength: 60 }).map((cs) => cs.join(''));

describe('code-point offsets', () => {
	it('counts characters, not UTF-16 code units', () => {
		// The whole hazard in one assertion: this string is 1 character and 2 code units.
		expect(codePointLength(EXT_B)).toBe(1);
		expect(EXT_B.length).toBe(2);
	});

	it('disagrees with .length exactly when astral characters are present', () => {
		expect(codePointLength('你好')).toBe('你好'.length);
		expect(codePointLength(`你好${EMOJI}`)).toBe(3);
		expect(`你好${EMOJI}`.length).toBe(4);
	});

	it('slices on character boundaries, never splitting a surrogate pair', () => {
		const text = `你${EXT_B}好`;
		expect(sliceByCodePoints(text, 1, 2)).toBe(EXT_B);
		expect(sliceByCodePoints(text, 0, 1)).toBe('你');
		expect(sliceByCodePoints(text, 2, 3)).toBe('好');
	});

	it('treats empty input as empty', () => {
		expect(codePointLength('')).toBe(0);
		expect(codePointsOf('')).toEqual([]);
		expect(sliceByCodePoints('', 0, 0)).toBe('');
	});

	it('round-trips any text through a full-width slice', () => {
		fc.assert(
			fc.property(anyText, (text) => {
				expect(sliceByCodePoints(text, 0, codePointLength(text))).toBe(text);
			})
		);
	});

	it('reassembles any text from consecutive single-character slices', () => {
		// This is the property tiling depends on: adjacent spans concatenate back to the source.
		fc.assert(
			fc.property(anyText, (text) => {
				const n = codePointLength(text);
				let rebuilt = '';
				for (let i = 0; i < n; i++) rebuilt += sliceByCodePoints(text, i, i + 1);
				expect(rebuilt).toBe(text);
			})
		);
	});

	it('agrees with how the language itself iterates characters', () => {
		fc.assert(
			fc.property(anyText, (text) => {
				expect(codePointLength(text)).toBe([...text].length);
				expect(codePointsOf(text)).toEqual([...text]);
			})
		);
	});

	it('reassembles any text from an arbitrary partition', () => {
		fc.assert(
			fc.property(anyText, fc.array(fc.nat(), { maxLength: 6 }), (text, rawCuts) => {
				const n = codePointLength(text);
				const cuts = [...new Set(rawCuts.map((c) => (n === 0 ? 0 : c % (n + 1))))].sort(
					(a, b) => a - b
				);
				const bounds = [0, ...cuts, n].filter((v, i, xs) => i === 0 || v !== xs[i - 1]);
				let rebuilt = '';
				for (let i = 0; i + 1 < bounds.length; i++) {
					rebuilt += sliceByCodePoints(text, bounds[i], bounds[i + 1]);
				}
				expect(rebuilt).toBe(text);
			})
		);
	});
});
