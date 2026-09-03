import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { splitIntoUnits } from '../../src/lib/analyzer/units';
import { CHINESE_UNIT_DELIMITERS } from '../../src/lib/analyzer/delimiters';

// A word never spans a subtitle line or a sentence end, so allowing one is always an error
// (FR-002, ADR-0013). Units are how that is prevented.
//
// The safety of the whole scheme rests on one property rather than on getting a delimiter set
// right by reasoning: units reassemble into the source exactly. A wrong delimiter set — a dropped
// character, an off-by-one, an ASCII full stop mistakenly admitted — breaks that immediately.

const ALPHABET = ['我', '在', '中', '国', '。', '！', '？', '\n', 'a', '1', '.', '，', ' '];
const anyText = fc.array(fc.constantFrom(...ALPHABET), { maxLength: 80 }).map((cs) => cs.join(''));

describe('segmentation units', () => {
	it('reassemble into the source exactly, for any text', () => {
		fc.assert(
			fc.property(anyText, (text) => {
				const units = splitIntoUnits(text, CHINESE_UNIT_DELIMITERS);
				expect(units.map((unit) => unit.text).join('')).toBe(text);
			})
		);
	});

	it('report offsets that are consistent with their text', () => {
		fc.assert(
			fc.property(anyText, (text) => {
				const units = splitIntoUnits(text, CHINESE_UNIT_DELIMITERS);
				let expected = 0;
				for (const unit of units) {
					expect(unit.start).toBe(expected);
					expected += [...unit.text].length;
				}
				expect(expected).toBe([...text].length);
			})
		);
	});

	it('never emit an empty unit', () => {
		fc.assert(
			fc.property(anyText, (text) => {
				for (const unit of splitIntoUnits(text, CHINESE_UNIT_DELIMITERS)) {
					expect(unit.text.length).toBeGreaterThan(0);
				}
			})
		);
	});

	it('treat empty input as no units at all', () => {
		expect(splitIntoUnits('', CHINESE_UNIT_DELIMITERS)).toEqual([]);
	});

	it('keep the delimiter with the unit it ends, so nothing is dropped', () => {
		const units = splitIntoUnits('我在。你好', CHINESE_UNIT_DELIMITERS);
		expect(units.map((unit) => unit.text)).toEqual(['我在。', '你好']);
	});

	it('break on a line break, because a subtitle line is a hard boundary', () => {
		const units = splitIntoUnits('第一行\n第二行', CHINESE_UNIT_DELIMITERS);
		expect(units).toHaveLength(2);
	});

	it('do NOT break on an ASCII full stop, which in Chinese sits inside numbers and URLs', () => {
		// The follow-up question that reshaped ADR-0013. In Chinese the terminator is 。; the ASCII
		// stop appears in 3.14, U.S., and example.com. Admitting it would split a decimal in half.
		expect(splitIntoUnits('圆周率是3.14。', CHINESE_UNIT_DELIMITERS)).toHaveLength(1);
	});

	it('is language-neutral about the rule, taking the delimiter set from its caller', () => {
		// The set is the language provider's (ADR-0013). Dutch will pass a set that DOES contain the
		// ASCII full stop, and this function must not have an opinion about that.
		const dutchLike = new Set(['.', '\n']);
		expect(splitIntoUnits('Ik loop. Jij ook.', dutchLike)).toHaveLength(2);
	});
});
