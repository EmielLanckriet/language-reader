import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { default_w } from 'ts-fsrs';
import { memoryOf, recall, reviewPredictions, type WordHistory } from '../../src/lib/domain/memory';
import {
	evaluateDataset,
	validateCandidate,
	validateDataset,
	type TuningDataset
} from '../../src/lib/domain/tuning';

const at = (day: number) => new Date(Date.UTC(2026, 0, day)).toISOString();
const ordered = (day: number) => ({ at: at(day), deviceId: 'd', deviceSeq: day });
function history(grades = [3, 1, 2, 4, 3, 1]): WordHistory {
	return {
		marks: [],
		exposures: [],
		answers: new Map(),
		events: grades.map((grade, i) => ({
			...ordered(1 + i * 3),
			kind: 'review',
			detail: { skill: 'reading', grade }
		}))
	};
}
function dataset(h = history()): TuningDataset {
	return {
		format: 1,
		rule: 'evidence-2',
		scheduler: 'ts-fsrs@5.4.2',
		exportedAt: at(30),
		words: [{ id: 1, history: { ...h, answers: [...h.answers] } }]
	};
}

describe('recall evaluation', () => {
	it('scores only explicit reviews, before updating, using the production state', () => {
		const h = history([3, 1]);
		h.events.splice(1, 0, { ...ordered(2), kind: 'check', detail: {}, sessionId: 1 });
		h.exposures.push({ ...ordered(3), sessionId: 2, modality: 'reading' });
		h.answers.set(2, 'all');
		const rows = reviewPredictions(h);
		expect(rows).toHaveLength(2);
		expect(rows[0].excluded).toBe('no-prior-memory');
		const before = { ...h, events: h.events.slice(0, -1) };
		const memory = memoryOf(before).reading!;
		expect(rows[1].probability).toBeCloseTo(recall(memory, new Date(at(4))), 12);
		expect(rows[1].rating).toBe(1);
	});

	it('a review answer cannot change its own prediction', () => {
		fc.assert(
			fc.property(
				fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 2, maxLength: 25 }),
				(grades) => {
					const h = history(grades);
					const before = reviewPredictions(h).at(-1)!.probability;
					h.events.at(-1)!.detail.grade = grades.at(-1) === 1 ? 4 : 1;
					expect(reviewPredictions(h).at(-1)!.probability).toBe(before);
				}
			)
		);
	});

	it('counts first and short-delay exclusions and retains short-delay updates', () => {
		const h = history([3, 1, 3]);
		h.events[1].at = new Date(new Date(at(1)).getTime() + 60_000).toISOString();
		const rows = reviewPredictions(h);
		expect(rows.map((row) => row.excluded)).toEqual(['no-prior-memory', 'short-delay', undefined]);
		const before = { ...h, events: h.events.slice(0, 2) };
		expect(rows[2].probability).toBeCloseTo(recall(memoryOf(before).reading!, new Date(at(7))), 12);
	});

	it('reports successes, losses, disjoint periods and skills without fabricating empty scores', () => {
		const report = evaluateDataset(dataset());
		expect(report.eligible).toBe(5);
		expect(report.development.all.count).toBe(4);
		expect(report.later.all.count).toBe(1);
		expect(report.development.all.successes).toBe(3); // Again fails; Hard/Good/Easy succeed.
		expect(report.development.listening.logLoss).toBeNull();
		expect(report.development.reading.logLoss).toBeGreaterThan(0);
		expect(report.development.reading.brier).toBeGreaterThan(0);
		const empty = evaluateDataset({ ...dataset(), words: [] });
		expect(empty.later.all.meanPrediction).toBeNull();
		expect(empty.eligible).toBe(0);
	});

	it('keeps tied timestamps together and excludes ambiguous clocks', () => {
		const one = dataset(history([3, 1]));
		one.words.push({ ...one.words[0], id: 2 });
		const tied = evaluateDataset(one);
		expect(tied.development.all.count).toBe(0);
		expect(tied.later.all.count).toBe(2);
		const h = history();
		h.events[1].deviceId = 'another';
		expect(evaluateDataset(dataset(h)).excluded['ambiguous-clock']).toBe(6);
		h.events[1].deviceId = 'd';
		h.events[1].at = at(0);
		expect(evaluateDataset(dataset(h)).eligible).toBe(0);
	});

	it('excludes an undated seed until a real update establishes a clock', () => {
		const h = history([3, 1]);
		h.marks.push({
			...ordered(0),
			asserted: 'known',
			provenance: 'anki 2025-12-01T00:00:00Z s=40 d=5'
		});
		expect(reviewPredictions(h)[0].excluded).toBe('undated-seed');
		expect(reviewPredictions(h)[1].probability).toBeGreaterThan(0);
	});

	it('refuses incompatible data and invalid weights instead of silently repairing them', () => {
		expect(() => validateCandidate({ weights: [...default_w] })).not.toThrow();
		expect(() => validateCandidate({ weights: [1] })).toThrow();
		expect(() => validateCandidate({ weights: default_w.map(() => NaN) })).toThrow();
		expect(() => validateCandidate({ weights: default_w.map(() => 1000) })).toThrow();
		expect(() => validateDataset(JSON.parse(JSON.stringify(dataset())))).not.toThrow();
		expect(() => validateDataset({ ...dataset(), scheduler: 'other' })).toThrow();
		const invalid = dataset();
		invalid.words[0].history.events[0].detail.grade = 9;
		expect(() => validateDataset(invalid)).toThrow();
	});
});
