import { describe, expect, it } from 'vitest';
import { default_w } from 'ts-fsrs';
import {
	applicable,
	baselineSet,
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

/** A seeded generator, so a failing history can be reproduced. */
function random(seed: number) {
	return () => {
		seed = (seed * 1103515245 + 12345) % 2 ** 31;
		return seed / 2 ** 31;
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
					if (seen) {
						h.exposures.push({ ...ordered(), sessionId: session, modality: 'reading' });
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
		strengths: { seenReading: 0.5, seenListening: 1, tapStability: 2 },
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
	const words = simulate(truth, 150);
	const cutoff = cutoffOf(score(words, start));
	const fitted = fit(words, start, cutoff, { iterations: 40, gammas: [1] });

	it('predicts later outcomes about as well as the parameters that made them (SC-002)', () => {
		const fittedLoss = loss(score(words, fitted.set), cutoff);
		expect(fittedLoss).toBeLessThanOrEqual(loss(score(words, truth), cutoff) * 1.02);
		// And it moved: today's rule predicts worse.
		expect(fittedLoss).toBeLessThan(loss(score(words, start), cutoff));
	});

	it('gives the same parameters every time', () => {
		expect(fit(words, start, cutoff, { iterations: 40, gammas: [1] }).set).toEqual(fitted.set);
	});

	it('is not moved by anything after the cutoff', () => {
		const changed = simulate(truth, 150);
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
