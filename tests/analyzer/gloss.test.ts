import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { explain, numberOf, type Dictionary, type Entry } from '../../src/lib/analyzer/gloss';

// Cases from the reader's own video (上海街头采访, 2026-09-27), against the shipped dictionary.

let dictionary: Dictionary;
beforeAll(() => {
	const entries = new Map<string, Entry[]>();
	for (const line of readFileSync('static/dictionary-zh.txt', 'utf-8').split('\n')) {
		if (!line || line.startsWith('#')) continue;
		const [word, pinyin, meaning] = line.split('\t');
		entries.set(word, [...(entries.get(word) ?? []), { pinyin, meaning }]);
	}
	dictionary = entries;
});

const first = (word: string) => explain(dictionary, word).map((part) => part.entries[0].meaning);

describe('what the word sheet says', () => {
	it('puts the ordinary sense before surnames and variants', () => {
		expect(first('钱')[0]).toMatch(/money/);
		expect(first('个')[0]).toMatch(/classifier/);
		expect(first('家')[0]).toMatch(/home/);
		expect(first('那')[0]).toMatch(/that/);
	});

	it('reads numbers as numbers', () => {
		expect(first('四千')).toEqual(['4,000']);
		expect(first('两三千')).toEqual(['2,000–3,000']);
		expect(first('一万')).toEqual(['10,000']);
		expect(numberOf('三十千')).toBe(30000);
		expect(numberOf('十五')).toBe(15);
	});

	it('explains a missing word by the longest dictionary words in it', () => {
		expect(explain(dictionary, '怎么说').map((part) => part.text)).toEqual(['怎么', '说']);
		expect(explain(dictionary, '我们俩').map((part) => part.text)).toEqual(['我们', '俩']);
	});

	it('reads a final 子 of a missing word as the noun suffix (县子: county)', () => {
		const [county, suffix] = explain(dictionary, '县子');
		expect(county.entries[0].meaning).toMatch(/county/);
		expect(suffix.entries[0]).toMatchObject({ pinyin: 'zi' });
	});
});

describe('the reading heard in context', () => {
	it('picks the sense with that reading', () => {
		expect(explain(dictionary, '说', ['shuō'])[0].entries[0].meaning).toMatch(/speak/);
		expect(explain(dictionary, '怎么说', ['zěn', 'me', 'shuō'])[1].entries[0].meaning).toMatch(
			/speak/
		);
	});

	it('reads a doubled verb as one word', () => {
		const [part] = explain(dictionary, '听听');
		expect(part.text).toBe('听听');
		expect(part.entries[0].meaning).toMatch(/listen.*doubled/);
	});
});
