import { describe, it, expect } from 'vitest';
import { State } from 'ts-fsrs';
import { textShares } from '../../src/lib/domain/shares';
import type { Memory } from '../../src/lib/domain/memory';
import type { WordState } from '../../src/lib/domain/types';

/** The library's shares: weighted by occurrence, FSRS before marks, ignored words left out. */
const now = new Date('2026-09-29T12:00:00Z');
const memory = (state: State, stability: number): Memory => ({
	stability,
	difficulty: 5,
	state,
	lastAt: '2026-09-28T12:00:00Z',
	due: '2026-12-01T12:00:00Z',
	reps: 3,
	lapses: 0,
	card: false,
	reviewed: true
});
const mark = (lexemeId: number, state: string): WordState => ({
	lexemeId,
	state,
	provenance: 'manual',
	userId: 1
});

describe('textShares', () => {
	it('weighs words by occurrence, trusts FSRS over marks, and leaves ignored words out', () => {
		const occurrences = new Map([
			[1, 5], // solid in FSRS, though marked learning
			[2, 2], // marked known, fragile in FSRS
			[3, 1], // marked known, no memory
			[4, 2], // never met
			[5, 10] // ignored
		]);
		const states = new Map([
			[1, mark(1, 'learning')],
			[2, mark(2, 'known')],
			[3, mark(3, 'known')],
			[5, mark(5, 'ignored')]
		]);
		const memories = new Map([
			[1, { reading: memory(State.Review, 1000) }],
			[2, { reading: memory(State.Learning, 1) }]
		]);
		expect(textShares(occurrences, states, memories, now)).toEqual({
			known: 6 / 10,
			learning: 2 / 10,
			fresh: 2 / 10
		});
	});
});
