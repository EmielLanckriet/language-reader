import { describe, it, expect } from 'vitest';
import { State } from 'ts-fsrs';
import { understood } from '../../src/lib/domain/shares';
import { recall, type Memory } from '../../src/lib/domain/memory';
import type { WordState } from '../../src/lib/domain/types';

/** The library's "~N% understood" (#13): today's in-context chance, averaged over running words. */
const now = new Date('2026-09-29T12:00:00Z');
const memory = (stability: number): Memory => ({
	stability,
	difficulty: 5,
	state: State.Review,
	lastAt: '2026-09-20T12:00:00Z',
	due: '2026-10-20T12:00:00Z',
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

describe('understood', () => {
	const occurrences = new Map([
		[1, 3], // solid
		[2, 1], // fading
		[3, 4], // new: 0
		[4, 2], // known from a mark, no memory: 1
		[5, 9] // ignored: left out
	]);
	const states = new Map([
		[4, mark(4, 'known')],
		[5, mark(5, 'ignored')]
	]);
	const memories = new Map([
		[1, { reading: memory(100) }],
		[2, { reading: memory(2) }],
		[5, { reading: memory(100) }]
	]);
	const r1 = recall(memory(100), now);
	const r2 = recall(memory(2), now);

	it('weighs each word by its occurrences, new words as 0 and known marks as 1', () => {
		expect(understood(occurrences, states, memories, now)).toBeCloseTo(
			(3 * r1 + 1 * r2 + 4 * 0 + 2 * 1) / 10,
			12
		);
	});

	it("maps recall through the set's noise, as the fit scores in-context outcomes", () => {
		const noise = { falseSuccess: 0.08, falseFailure: 0.04 };
		const seen = (r: number) => 0.08 + (1 - 0.08 - 0.04) * r;
		expect(understood(occurrences, states, memories, now, undefined, noise)).toBeCloseTo(
			(3 * seen(r1) + 1 * seen(r2) + 4 * 0 + 2 * 1) / 10,
			12
		);
	});

	it('is undefined when every word is ignored', () => {
		expect(understood(new Map([[5, 9]]), states, memories, now)).toBeUndefined();
	});
});
