/**
 * FSRS-6 as ts-fsrs 5.4.2 computes it (node_modules/ts-fsrs/dist/index.mjs, `next_state` and the
 * functions it calls), without its rounding to 8 decimals: the fit differentiates these numerically,
 * and rounding would turn small steps into noise (spec 013, research R4). Short-term (same-day)
 * stability is on, as in Reader's scheduler. tests/domain/fsrs6.test.ts holds it to ts-fsrs.
 */

import { S_MIN } from 'ts-fsrs';

const S_MAX = 36500;

export interface MemoryState {
	stability: number;
	difficulty: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** Chance of recall `t` whole days after the last review, for stability `s`. */
export function retrievability(w: readonly number[], t: number, s: number): number {
	const decay = -w[20];
	const factor = Math.pow(0.9, 1 / decay) - 1;
	return Math.pow(1 + (factor * t) / s, decay);
}

function initialDifficulty(w: readonly number[], g: number): number {
	return w[4] - Math.exp((g - 1) * w[5]) + 1;
}

function nextDifficulty(w: readonly number[], d: number, g: number): number {
	const damped = d + (-w[6] * (g - 3) * (10 - d)) / 9;
	// Mean reversion towards the difficulty of a first Easy.
	return clamp(w[7] * initialDifficulty(w, 4) + (1 - w[7]) * damped, 1, 10);
}

/**
 * The memory after grade `g`, `t` calendar days after the last review; `undefined` for a word
 * with no memory yet, which starts one from the grade alone.
 */
export function nextState(
	w: readonly number[],
	memory: MemoryState | undefined,
	t: number,
	g: 1 | 2 | 3 | 4
): MemoryState {
	if (!memory)
		return {
			stability: Math.max(w[g - 1], 0.1),
			difficulty: clamp(initialDifficulty(w, g), 1, 10)
		};
	const { stability: s, difficulty: d } = memory;
	const r = retrievability(w, t, s);
	let stability: number;
	if (t === 0) {
		const growth = Math.pow(s, -w[19]) * Math.exp(w[17] * (g - 3 + w[18]));
		stability = clamp(s * (g >= 2 ? Math.max(growth, 1) : growth), S_MIN, S_MAX);
	} else if (g === 1) {
		const afterLapse = clamp(
			w[11] * Math.pow(d, -w[12]) * (Math.pow(s + 1, w[13]) - 1) * Math.exp((1 - r) * w[14]),
			S_MIN,
			S_MAX
		);
		// Never more than before, nor less than this floor.
		stability = clamp(s / Math.exp(w[17] * w[18]), S_MIN, afterLapse);
	} else {
		const hard = g === 2 ? w[15] : 1;
		const easy = g === 4 ? w[16] : 1;
		const growth = Math.exp(w[8]) * (11 - d) * Math.pow(s, -w[9]) * (Math.exp((1 - r) * w[10]) - 1);
		stability = clamp(s * (1 + growth * hard * easy), S_MIN, S_MAX);
	}
	return { stability, difficulty: nextDifficulty(w, d, g) };
}
