import { describe, it, expect } from 'vitest';
import { readingsOf } from '../../src/lib/analyzer/pronounce';
import { codePointsOf } from '../../src/lib/domain/offsets';

// Pinyin is shown per character by the document's code-point offsets, so it must line up with them.

describe('readings', () => {
	it('give one reading per code point, empty where the character is not Chinese', async () => {
		const text = '我用iPhone，😀看书\n你好';
		const readings = await readingsOf(text);
		expect(readings).toHaveLength(codePointsOf(text).length);
		expect(readings[0]).toBe('wǒ');
		expect(readings[2]).toBe('');
		expect(readings[codePointsOf(text).indexOf('看')]).toBe('kàn');
		expect(readings[codePointsOf(text).indexOf('😀')]).toBe('');
	});
});
