import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { windowPlan, keep, type Token } from '../../src/lib/speech/windows';

/**
 * The transcript is the windows' kept tokens concatenated, so a gap between keep ranges loses
 * speech and an overlap writes it twice. Research R3.
 */
const duration = fc.double({ min: 0.5, max: 4000, noNaN: true });
const first = fc.integer({ min: 5, max: 30 });

describe('the window plan', () => {
	it('keeps every moment of the audio in exactly one window', () => {
		fc.assert(
			fc.property(duration, first, (d, f) => {
				const plan = windowPlan(d, { first: f, length: 30, overlap: 2 });
				expect(plan[0].keepFrom).toBe(0);
				expect(plan.at(-1)!.keepTo).toBe(d);
				plan.forEach((w, i) => {
					if (i) expect(w.keepFrom).toBe(plan[i - 1].keepTo);
					expect(w.keepTo).toBeGreaterThan(w.keepFrom);
					expect(w.start).toBeLessThanOrEqual(w.keepFrom);
					expect(w.end).toBeGreaterThanOrEqual(w.keepTo);
					expect(w.end - w.start).toBeLessThanOrEqual(30);
				});
			})
		);
	});

	it('survives JSON, since a resumed transcript recomputes and compares it', () => {
		fc.assert(
			fc.property(duration, first, (d, f) => {
				const plan = windowPlan(d, { first: f, length: 30, overlap: 2 });
				expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
			})
		);
	});
});

describe('keeping a window’s tokens', () => {
	it('keeps exactly the tokens inside its range, so the windows together keep each token once', () => {
		fc.assert(
			fc.property(
				duration,
				fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { maxLength: 200, size: 'max' }),
				(d, fractions) => {
					const plan = windowPlan(d, { first: 10, length: 30, overlap: 2 });
					const tokens: Token[] = fractions.map((x, i) => [`t${i}`, x * d * 0.999]);
					const kept = plan.flatMap((w, i) =>
						keep(
							plan,
							i,
							tokens.filter(([, t]) => t >= w.start && t < w.end)
						)
					);
					expect([...kept].sort((a, b) => a[1] - b[1])).toEqual(
						[...tokens].sort((a, b) => a[1] - b[1])
					);
				}
			)
		);
	});
});
