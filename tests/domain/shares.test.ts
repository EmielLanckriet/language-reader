import { describe, it, expect } from 'vitest';
import { State } from 'ts-fsrs';
import { textShares } from '../../src/lib/domain/shares';
import type { Memory } from '../../src/lib/domain/memory';

/** The library's shares: weighted by occurrence, by recall alone (spec 019: never by mark or status). */
const now = new Date('2026-09-29T12:00:00Z');
const memory = (state: State, stability: number): Memory => ({
	stability,
	difficulty: 5,
	state,
	lastAt: '2026-09-28T12:00:00Z',
	due: '2026-12-01T12:00:00Z',
	reps: 3,
	lapses: 0
});

describe('textShares', () => {
	it('weighs words by occurrence and counts every word with a memory by its recall', () => {
		const occurrences = new Map([
			[1, 5], // solid in FSRS
			[2, 2], // fragile in FSRS
			[3, 1], // no memory: new, whatever it was once marked
			[4, 2], // never met
			[5, 10] // ignored, solid in FSRS: counted like any other
		]);
		const memories = new Map([
			[1, { reading: memory(State.Review, 1000) }],
			[2, { reading: memory(State.Learning, 1) }],
			[5, { reading: memory(State.Review, 1000) }]
		]);
		expect(textShares(occurrences, memories, now)).toEqual({
			known: 15 / 20,
			learning: 2 / 20,
			fresh: 3 / 20
		});
	});
});
