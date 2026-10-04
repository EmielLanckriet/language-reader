import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { CLAMP_PARAMETERS, fsrs, generatorParameters, W17_W18_Ceiling } from 'ts-fsrs';
import { nextState, retrievability } from '../../src/lib/domain/fsrs6';

// The fit's FSRS-6 (spec 013, research R4): the same steps as ts-fsrs, without its rounding, so it
// can be differentiated numerically. ts-fsrs stays the reference: these must agree with it.

/** Any FSRS-6 weights ts-fsrs accepts, within its bounds: the fit moves them all. */
const anyWeights = fc.tuple(
	...CLAMP_PARAMETERS(W17_W18_Ceiling, true).map(([low, high]) =>
		fc.double({ min: low, max: high, noNaN: true })
	)
);
const close = (a: number, b: number) => expect(Math.abs(a - b)).toBeLessThan(1e-6 * Math.max(1, b));
const reference = (w: number[]) =>
	fsrs(generatorParameters({ w, enable_short_term: true, enable_fuzz: false }));

describe('FSRS-6 steps, for any weights', () => {
	it('start a memory as ts-fsrs does', () => {
		fc.assert(
			fc.property(anyWeights, fc.constantFrom(1, 2, 3, 4), (w, g) => {
				const mine = nextState(w, undefined, 0, g);
				const theirs = reference(w).next_state(null, 0, g);
				close(mine.stability, theirs.stability);
				close(mine.difficulty, theirs.difficulty);
			})
		);
	});

	it('update a memory as ts-fsrs does, same day and later', () => {
		fc.assert(
			fc.property(
				anyWeights,
				fc.double({ min: 0.01, max: 2000, noNaN: true }),
				fc.double({ min: 1, max: 10, noNaN: true }),
				fc.integer({ min: 0, max: 400 }),
				fc.constantFrom(1, 2, 3, 4),
				(w, stability, difficulty, t, g) => {
					const mine = nextState(w, { stability, difficulty }, t, g);
					const theirs = reference(w).next_state({ stability, difficulty }, t, g);
					close(mine.stability, theirs.stability);
					close(mine.difficulty, theirs.difficulty);
				}
			)
		);
	});

	it('forget as ts-fsrs does', () => {
		fc.assert(
			fc.property(
				anyWeights,
				fc.double({ min: 0.01, max: 2000, noNaN: true }),
				fc.integer({ min: 0, max: 400 }),
				(w, stability, t) => {
					close(retrievability(w, t, stability), reference(w).forgetting_curve(t, stability));
				}
			)
		);
	});
});
