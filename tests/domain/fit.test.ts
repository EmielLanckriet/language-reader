import { describe, expect, it } from 'vitest';
import { default_w } from 'ts-fsrs';
import {
	applicable,
	baselineSet,
	checkParameterSet,
	compare,
	cutoffOf,
	fit,
	idOf,
	prepareWords,
	score,
	type FitWord,
	type ParameterSet,
	type Scored
} from '../../src/lib/domain/fit';
import { prepare, replay } from '../../src/lib/domain/replay';
import type { WordHistory } from '../../src/lib/domain/memory';

// The fit (spec 013, T025): it should find parameters that predict later outcomes about as well as
// the ones that generated them, refuse a verdict on too little, and never look at the later period.

/**
 * A seeded generator, so a failing history can be reproduced (mulberry32: an earlier linear one
 * overflowed double precision and mixed badly, audit 2026-10-04).
 */
function random(seed: number) {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Histories drawn from `truth`: each outcome sampled from the chance it predicts at that moment. */
function simulate(truth: ParameterSet, words: number, seed = 7): FitWord[] {
	const next = random(seed);
	let seq = 0;
	let session = 0;
	return prepareWords(
		Array.from({ length: words }, (_, id) => {
			const h: WordHistory = { marks: [], events: [], exposures: [], answers: new Map() };
			let time = Date.UTC(2026, 0, 1 + Math.floor(next() * 60), 9);
			const ordered = () => ({ at: new Date(time).toISOString(), deviceId: 'd', deviceSeq: ++seq });
			const chance = () => {
				let p = 0;
				replay(prepare(h), truth.weights, truth.strengths, (o) => {
					if (o.probability !== null) p = o.probability;
				});
				return p;
			};
			h.events.push({ ...ordered(), kind: 'review', detail: { skill: 'reading', grade: 3 } });
			for (let k = 0; k < 8; k++) {
				time += (1 + Math.floor(next() * 20)) * 86_400_000;
				// The chance at this moment: a probe review scored and then removed.
				h.events.push({ ...ordered(), kind: 'review', detail: { skill: 'reading', grade: 3 } });
				const r = chance();
				h.events.pop();
				if (next() < 0.5) {
					const grade = next() < r ? 3 : 1;
					h.events.push({ ...ordered(), kind: 'review', detail: { skill: 'reading', grade } });
				} else {
					const seen =
						next() < truth.falseSuccess + (1 - truth.falseSuccess - truth.falseFailure) * r;
					session++;
					// Half of them in a sentence seen up to a month before (issue #6).
					const rewatch = next() < 0.5 ? { rewatchDays: next() * 30 } : {};
					if (seen) {
						h.exposures.push({
							...ordered(),
							sessionId: session,
							modality: 'reading',
							...rewatch
						});
						h.answers.set(session, 'all');
					} else
						h.events.push({
							...ordered(),
							kind: 'lookup',
							sessionId: session,
							modality: 'reading',
							detail: {}
						});
				}
			}
			return { id, history: h };
		})
	);
}

const start = baselineSet([...default_w], 0.9);
const truth: ParameterSet = (() => {
	const set = {
		...start,
		strengths: {
			seenReading: 0.5,
			seenListening: 1,
			tapStability: 2,
			rewatchDiscount: 0.9,
			rewatchHalfLife: 14
		},
		falseSuccess: 0.15,
		falseFailure: 0.05
	};
	return { ...set, id: idOf(set) };
})();
const loss = (rows: Scored[], cutoff: number) => {
	const later = rows.filter((r) => r.at >= cutoff);
	return (
		later.reduce((sum, r) => {
			const p = Math.min(1 - 1e-12, Math.max(1e-12, r.probability));
			return sum - (r.label * Math.log(p) + (1 - r.label) * Math.log(1 - p));
		}, 0) / later.length
	);
};

// Each fit replays the whole history about two thousand times; CI is slower than a laptop.
describe('fitting', { timeout: 60_000 }, () => {
	const words = simulate(truth, 400);
	const cutoff = cutoffOf(score(words, start));
	const fitted = fit(words, start, cutoff, { iterations: 40, gammas: [1] });

	it('predicts later outcomes about as well as the parameters that made them (SC-002)', () => {
		const fittedLoss = loss(score(words, fitted.set), cutoff);
		expect(fittedLoss).toBeLessThanOrEqual(loss(score(words, truth), cutoff) * 1.02);
		// And it moved: today's rule predicts worse.
		expect(fittedLoss).toBeLessThan(loss(score(words, start), cutoff));
	});

	// Not towards the truth: measured 2026-10-08, across discounts 0 to 1 the earlier loss here moves
	// by 1.3 of 768, noise favouring the low end. The data barely tells the discount; the fit must
	// still be able to move it.
	it('fits the rewatch strengths too', () => {
		expect(fitted.set.strengths.rewatchDiscount).not.toBe(0.5);
		expect(fitted.set.strengths.rewatchHalfLife).not.toBe(14);
	});

	it('gives the same parameters every time', () => {
		expect(fit(words, start, cutoff, { iterations: 40, gammas: [1] }).set).toEqual(fitted.set);
	});

	it('is not moved by anything after the cutoff', () => {
		const changed = simulate(truth, 400);
		// Flip the last outcome of every word whose last observation is after the cutoff.
		for (const word of changed)
			for (const skill of word.prepared) {
				const last = skill.steps.at(-1);
				if (last && last.at >= cutoff && last.type === 'card')
					last.grade = last.grade === 1 ? 3 : 1;
			}
		expect(fit(changed, start, cutoff, { iterations: 40, gammas: [1] }).set).toEqual(fitted.set);
	});
});

describe('scoring', () => {
	it('expects an in-context observation through its noise, and a card answer without', () => {
		const words = simulate(truth, 30);
		const plain = score(words, { ...truth, falseSuccess: 0, falseFailure: 0 });
		const noisy = score(words, truth);
		noisy.forEach((row, i) => {
			const expected =
				row.type === 'in-context'
					? truth.falseSuccess +
						(1 - truth.falseSuccess - truth.falseFailure) * plain[i].probability
					: plain[i].probability;
			expect(row.probability).toBeCloseTo(expected, 12);
		});
		expect(noisy.some((row) => row.type === 'in-context')).toBe(true);
	});
});

describe('the verdict', () => {
	const verdict = (
		v: 'better' | 'not better' | 'too little data',
		interval: [number, number] | null
	) => ({ count: v === 'too little data' ? 10 : 500, difference: null, interval, verdict: v });

	it('applies only what predicted reading better, and never what predicted cards worse (FR-012)', () => {
		const better = verdict('better', [-0.05, -0.01]);
		expect(applicable(better, verdict('not better', [-0.01, 0.02]))).toEqual({
			ok: true,
			why: 'predicted better'
		});
		expect(applicable(better, verdict('too little data', null)).ok).toBe(true);
		expect(applicable(better, verdict('not better', [0.001, 0.03]))).toEqual({
			ok: false,
			why: 'predicted card answers worse'
		});
		expect(applicable(verdict('not better', [-0.02, 0.01]), better)).toEqual({
			ok: false,
			why: 'did not predict better'
		});
		expect(applicable(verdict('too little data', null), better)).toEqual({
			ok: false,
			why: 'too little data while reading'
		});
	});

	it('says too little data below the minimum, and then nothing can be applied', () => {
		const words = simulate(truth, 6);
		const cutoff = cutoffOf(score(words, start));
		const inContext = compare(score(words, truth), score(words, start), 'in-context', cutoff);
		const card = compare(score(words, truth), score(words, start), 'card', cutoff);
		expect(inContext.verdict).toBe('too little data');
		expect(applicable(inContext, card).ok).toBe(false);
	});

	// Measured 2026-10-04: at 340 later outcomes the true parameters were 0.037 better per outcome,
	// with an interval just reaching above 0. A difference this size needs hundreds more to show.
	it('finds the generating parameters better than today’s rule, given enough data', () => {
		const words = simulate(truth, 1000, 11);
		const cutoff = cutoffOf(score(words, start));
		const inContext = compare(score(words, truth), score(words, start), 'in-context', cutoff);
		const card = compare(score(words, truth), score(words, start), 'card', cutoff);
		expect(inContext.verdict).toBe('better');
		expect(applicable(inContext, card)).toEqual({ ok: true, why: 'predicted better' });
	});
});

describe('a set stored before the rewatch strengths (issue #6)', () => {
	// The baseline as `fit-1` named it: its id was computed before rewatching had numbers of its own.
	const stored = {
		id: 'ec0e6825',
		model: 'fit-1',
		weights: [...default_w],
		strengths: { seenReading: 1, seenListening: 1, tapStability: 1 },
		falseSuccess: 0,
		falseFailure: 0,
		retention: 0.9
	};

	it('is still accepted under its own id', () => {
		expect(() => checkParameterSet(stored)).not.toThrow();
	});

	it('is fitted onwards into a set with the rewatch strengths, from where they start', () => {
		const set = baselineSet([...default_w], 0.9);
		expect(set.model).toBe('fit-2');
		expect(set.strengths).toMatchObject({ rewatchDiscount: 0.5, rewatchHalfLife: 14 });
		expect(() => checkParameterSet(set)).not.toThrow();
		const fitted = fit(simulate(truth, 20), stored as ParameterSet, Infinity, {
			iterations: 1,
			gammas: [1]
		}).set;
		expect(fitted.model).toBe('fit-2');
		expect(fitted.strengths.rewatchHalfLife).toBeCloseTo(14, 0);
	});
});
