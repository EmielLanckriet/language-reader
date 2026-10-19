import { describe, it, expect } from 'vitest';
import { COLUMNS, matches, sortWords } from '../../src/lib/ui/word-list';
import type { WordListEntry } from '../../src/lib/storage/repository';

// Issue #47: the word list is searched by characters, by pinyin as typed, or by English.

const fruit = { pinyin: 'shuǐ guǒ', meaning: 'fruit' };

describe('searching the word list', () => {
	it('finds a word by characters, toneless pinyin with or without spaces, or meaning', () => {
		expect(matches('水果', fruit, '水')).toBe(true);
		expect(matches('水果', fruit, 'shuiguo')).toBe(true);
		expect(matches('水果', fruit, 'shui guo')).toBe(true);
		expect(matches('水果', fruit, 'shui3')).toBe(true);
		expect(matches('水果', fruit, 'Fruit')).toBe(true);
		expect(matches('水果', fruit, 'shuo')).toBe(false);
		expect(matches('水果', undefined, 'shui')).toBe(false);
	});

	it('sorts words without a value last, in both directions', () => {
		const word = (id: number, stability?: number): WordListEntry => ({
			id,
			form: String(id),
			status: 'retired',
			...(stability === undefined
				? {}
				: {
						reading: {
							stability,
							difficulty: 5,
							state: 2,
							lastAt: '2026-10-01T00:00:00Z',
							due: '2026-10-20T00:00:00Z',
							reps: 1,
							lapses: 0
						}
					})
		});
		const words = [word(1, 30), word(2), word(3, 2)];
		const column = COLUMNS.find((c) => c.key === 'reading-stability')!;
		const ids = (descending: boolean) =>
			sortWords(words, column, descending, new Map(), { now: new Date() }).map((w) => w.id);
		expect(ids(false)).toEqual([3, 1, 2]);
		expect(ids(true)).toEqual([1, 3, 2]);
	});
});
