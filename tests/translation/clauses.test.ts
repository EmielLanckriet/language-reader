import { describe, it, expect } from 'vitest';
import { clausesOf } from '../../src/lib/translation/lines';

describe('clausesOf', () => {
	it('shows as one the lines one English cue spans, and every other line on its own', () => {
		const chinese = [
			{ start: 1, end: 2 },
			{ start: 2, end: 3.5 },
			{ start: 3.5, end: 5 },
			{ start: 5, end: 6 },
			{ start: 6, end: 7 }
		];
		// 0-1 as one clause, 2 alone, 3 with no English yet, 4 alone.
		const english = [
			{ start: 1, end: 3.5 },
			{ start: 3.5, end: 5 },
			{ start: 6, end: 7 }
		];
		expect(clausesOf(chinese, english)).toEqual([
			[0, 1],
			[2, 2],
			[3, 3],
			[4, 4]
		]);
	});
});
