import { describe, it, expect } from 'vitest';
import { State } from 'ts-fsrs';
import { wordCounts } from '../../src/lib/domain/shares';
import type { Memory } from '../../src/lib/domain/memory';
import type { WordState } from '../../src/lib/domain/types';

/** The library's counts: due words that come up, new words, and the new words that recur. */
const now = new Date('2026-09-29T12:00:00Z');
const memory = (due: string): Memory => ({
	stability: 10,
	difficulty: 5,
	state: State.Review,
	lastAt: '2026-09-20T12:00:00Z',
	due,
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

describe('wordCounts', () => {
	it('counts due words with their occurrences, and new words recurring in 3 or more lines', () => {
		const occurrences = new Map([
			[1, 4], // due
			[2, 3], // due exactly now
			[3, 9], // not yet due
			[4, 5], // new, in 3 lines
			[5, 6], // new, 6 times but in 2 lines
			[6, 2], // marked, no memory: not new
			[7, 8], // ignored, though due
			[8, 1] // new, once
		]);
		const lines = new Map([
			[1, 2],
			[2, 1],
			[3, 5],
			[4, 3],
			[5, 2],
			[6, 2],
			[7, 4],
			[8, 1]
		]);
		const states = new Map([
			[6, mark(6, 'known')],
			[7, mark(7, 'ignored')]
		]);
		const memories = new Map([
			[1, { reading: memory('2026-09-28T12:00:00Z') }],
			[2, { reading: memory('2026-09-29T12:00:00Z') }],
			[3, { reading: memory('2026-09-30T12:00:00Z') }],
			[7, { reading: memory('2026-09-01T12:00:00Z') }]
		]);
		expect(wordCounts(occurrences, lines, states, memories, now)).toEqual({
			due: 2,
			dueOccurrences: 7,
			fresh: 3,
			freshRecurring: 1
		});
	});
});
