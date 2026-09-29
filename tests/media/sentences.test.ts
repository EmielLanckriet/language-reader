import { describe, it, expect } from 'vitest';
import { joinWithNext, runsOf, splitApart } from '../../src/lib/media/sentences';

describe('sentences the reader joined', () => {
	it('joins a line with the next, again with the next, and takes the whole run apart', () => {
		let joined = joinWithNext(runsOf(5, []), 1);
		expect(runsOf(5, joined)).toEqual([
			[0, 0],
			[1, 2],
			[3, 3],
			[4, 4]
		]);
		joined = joinWithNext(runsOf(5, joined), 1);
		expect(runsOf(5, joined)).toEqual([
			[0, 0],
			[1, 3],
			[4, 4]
		]);
		joined = joinWithNext(runsOf(5, joined), 0);
		expect(runsOf(5, joined)).toEqual([
			[0, 3],
			[4, 4]
		]);
		expect(runsOf(5, splitApart(runsOf(5, joined), 0))).toEqual([
			[0, 0],
			[1, 1],
			[2, 2],
			[3, 3],
			[4, 4]
		]);
		// The last line has nothing after it to join.
		expect(joinWithNext(runsOf(5, joined), 1)).toEqual([[0, 3]]);
	});

	it('ignores a kept run that no longer fits the lines', () => {
		expect(
			runsOf(3, [
				[1, 5],
				[0, 0]
			])
		).toEqual([
			[0, 0],
			[1, 1],
			[2, 2]
		]);
	});
});
