import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { default_w, fsrs, generatorParameters } from 'ts-fsrs';
import { nextState, retrievability } from '../../src/lib/domain/fsrs6';

// The fit's FSRS-6 (spec 013, research R4): the same steps as ts-fsrs, without its rounding, so it
// can be differentiated numerically. ts-fsrs stays the reference: these must agree with it.

const anki = [
	0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
	0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
];
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6 * Math.max(1, b));

describe('FSRS-6 steps', () => {
	for (const [name, w] of [
		['default', [...default_w]],
		['Anki', anki]
	] as const) {
		const reference = fsrs(generatorParameters({ w, enable_short_term: true, enable_fuzz: false }));

		it(`start a memory as ts-fsrs does (${name} weights)`, () => {
			for (const g of [1, 2, 3, 4] as const) {
				const mine = nextState(w, undefined, 0, g);
				const theirs = reference.next_state(null, 0, g);
				close(mine.stability, theirs.stability);
				close(mine.difficulty, theirs.difficulty);
			}
		});

		it(`update a memory as ts-fsrs does, same day and later (${name} weights)`, () => {
			fc.assert(
				fc.property(
					fc.double({ min: 0.01, max: 2000, noNaN: true }),
					fc.double({ min: 1, max: 10, noNaN: true }),
					fc.integer({ min: 0, max: 400 }),
					fc.constantFrom(1, 2, 3, 4),
					(stability, difficulty, t, g) => {
						const mine = nextState(w, { stability, difficulty }, t, g);
						const theirs = reference.next_state({ stability, difficulty }, t, g);
						close(mine.stability, theirs.stability);
						close(mine.difficulty, theirs.difficulty);
					}
				)
			);
		});

		it(`forget as ts-fsrs does (${name} weights)`, () => {
			fc.assert(
				fc.property(
					fc.double({ min: 0.01, max: 2000, noNaN: true }),
					fc.integer({ min: 0, max: 400 }),
					(stability, t) => {
						close(retrievability(w, t, stability), reference.forgetting_curve(t, stability));
					}
				)
			);
		});
	}
});
