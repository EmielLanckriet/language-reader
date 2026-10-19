import { describe, it, expect } from 'vitest';
import { State } from 'ts-fsrs';
import { understood } from '../../src/lib/domain/shares';
import { recall, type Memory } from '../../src/lib/domain/memory';

/** The library's "~N% understood" (#13): today's in-context chance, averaged over running words. */
const now = new Date('2026-09-29T12:00:00Z');
const memory = (stability: number): Memory => ({
	stability,
	difficulty: 5,
	state: State.Review,
	lastAt: '2026-09-20T12:00:00Z',
	due: '2026-10-20T12:00:00Z',
	reps: 3,
	lapses: 0
});

describe('understood', () => {
	const occurrences = new Map([
		[1, 3], // solid
		[2, 1], // fading
		[3, 4], // new: 0
		[5, 9] // ignored: counted by recall like any other word (spec 019)
	]);
	const memories = new Map([
		[1, { reading: memory(100) }],
		[2, { reading: memory(2) }],
		[5, { reading: memory(100) }]
	]);
	const r1 = recall(memory(100), now);
	const r2 = recall(memory(2), now);

	it('weighs each word by its occurrences, new words as 0', () => {
		expect(understood(occurrences, memories, now)).toBeCloseTo(
			(3 * r1 + 1 * r2 + 4 * 0 + 9 * r1) / 17,
			12
		);
	});

	it("maps recall through the set's noise, as the fit scores in-context outcomes", () => {
		const noise = { falseSuccess: 0.08, falseFailure: 0.04 };
		const seen = (r: number) => 0.08 + (1 - 0.08 - 0.04) * r;
		expect(understood(occurrences, memories, now, undefined, noise)).toBeCloseTo(
			(3 * seen(r1) + 1 * seen(r2) + 4 * 0 + 9 * seen(r1)) / 17,
			12
		);
	});

	it('is undefined for a text with no words', () => {
		expect(understood(new Map(), memories, now)).toBeUndefined();
	});
});
