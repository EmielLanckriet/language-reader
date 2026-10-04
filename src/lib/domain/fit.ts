/**
 * Fitting personal parameters (spec 013, ADR-0037, research R4–R5): FSRS-6's 21 weights, how
 * strongly a tap and a word read untapped count, and how noisy in-context observations are.
 *
 * - Only outcomes before the cutoff (the 80% timestamp, as `evaluateDataset`) are fitted; the rest
 *   are scored afterwards with the parameters frozen.
 * - A prior pulls every number towards where it starts — the Anki weights, today's rule — so a
 *   small history cannot move it far. Its strength is chosen inside the earlier period only.
 * - Gradients are central differences over `replay`; the steps are Adam's, kept inside bounds.
 *   Slower than derived gradients, but nothing to keep in step with the rules (research R4).
 * - Everything is deterministic: the same export gives the same parameters on any machine.
 */

import { prepare, replay, type PreparedSkill } from './replay';
import type { RuleStrengths, WordHistory } from './memory';
import type { Skill } from './encounter';
import { clockAmbiguous, validateDataset, type TuningDataset } from './tuning';
import { CLAMP_PARAMETERS, default_w, W17_W18_Ceiling } from 'ts-fsrs';

export const MODEL = 'fit-1';
/** Fewer later outcomes of a type than this, and no verdict is given (spec assumption). */
export const MIN_OUTCOMES = 100;

export interface ParameterSet {
	id: string;
	model: typeof MODEL;
	weights: number[];
	strengths: RuleStrengths;
	/** P(observed understood) = falseSuccess + (1 − falseSuccess − falseFailure) · recall. */
	falseSuccess: number;
	falseFailure: number;
	/** The reader's preference, copied, never fitted. */
	retention: number;
}

export interface FitWord {
	id: number;
	prepared: PreparedSkill[];
}

/** fsrs-rs's per-weight prior spread for FSRS-6 (training_v6.rs), then the five extras'. */
const SIGMA = [
	6.43, 9.66, 17.58, 27.85, 0.57, 0.28, 0.6, 0.12, 0.39, 0.18, 0.33, 0.3, 0.09, 0.16, 0.57, 0.25,
	1.03, 0.31, 0.32, 0.14, 0.27, 0.5, 0.5, 0.5, 0.05, 0.05
];
const EXTRA_CENTRE = [1, 1, 1, 0.1, 0.05];
const BOUNDS = [
	...(CLAMP_PARAMETERS(W17_W18_Ceiling, true) as [number, number][]),
	[0, 2],
	[0, 2],
	[0.2, 5],
	[0, 0.4],
	[0, 0.4]
];

function vectorOf(set: ParameterSet): number[] {
	const { seenReading, seenListening, tapStability } = set.strengths;
	return [
		...set.weights,
		seenReading,
		seenListening,
		tapStability,
		set.falseSuccess,
		set.falseFailure
	];
}

function setOf(v: number[], retention: number): ParameterSet {
	const set = {
		model: MODEL as typeof MODEL,
		weights: v.slice(0, 21),
		strengths: { seenReading: v[21], seenListening: v[22], tapStability: v[23] },
		falseSuccess: v[24],
		falseFailure: v[25],
		retention
	};
	return { id: idOf(set), ...set };
}

/** A short stable name for a set: FNV-1a over its numbers, rounded so the platform cannot matter. */
export function idOf(set: Omit<ParameterSet, 'id'>): string {
	const text = JSON.stringify([
		set.model,
		[...set.weights, ...Object.values(set.strengths), set.falseSuccess, set.falseFailure].map(
			(x) => Math.round(x * 1e8) / 1e8
		),
		set.retention
	]);
	let hash = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
	return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Today's rule as a parameter set: these weights, every strength 1, no noise. */
export function baselineSet(weights: number[], retention: number): ParameterSet {
	return setOf([...weights, 1, 1, 1, 0, 0], retention);
}

export function prepareWords(words: { id: number; history: WordHistory }[]): FitWord[] {
	return words.map(({ id, history }) => ({ id, prepared: prepare(history) }));
}

export interface Scored {
	word: number;
	type: 'card' | 'in-context';
	skill: Skill;
	at: number;
	label: 0 | 1;
	/** The chance of the observed outcome being "understood", noise included. */
	probability: number;
}

/** Every scored observation of every word under `set`, in a fixed order. */
export function score(words: FitWord[], set: ParameterSet): Scored[] {
	const rows: Scored[] = [];
	words.forEach(({ prepared }, word) => {
		replay(prepared, set.weights, set.strengths, (o) => {
			if (o.probability === null) return;
			const p =
				o.type === 'in-context'
					? set.falseSuccess + (1 - set.falseSuccess - set.falseFailure) * o.probability
					: o.probability;
			rows.push({ word, type: o.type, skill: o.skill, at: o.at, label: o.label, probability: p });
		});
	});
	return rows;
}

function logLoss(row: Scored): number {
	const p = Math.min(1 - 1e-12, Math.max(1e-12, row.probability));
	return -(row.label * Math.log(p) + (1 - row.label) * Math.log(1 - p));
}

/** The 80% timestamp of the rows, ties kept later, as `evaluateDataset` splits. */
export function cutoffOf(rows: { at: number }[]): number {
	if (rows.length < 2) return Infinity;
	const times = rows.map((r) => r.at).sort((a, b) => a - b);
	return times[Math.floor(times.length * 0.8)];
}

interface FitOptions {
	iterations?: number;
	gammas?: number[];
}

/**
 * Fits on the rows before `cutoff`, starting at (and pulled towards) `start`. Returns the fitted
 * set and the prior strength chosen.
 */
export function fit(
	words: FitWord[],
	start: ParameterSet,
	cutoff: number,
	options: FitOptions = {}
): { set: ParameterSet; gamma: number; iterations: number } {
	const gammas = options.gammas ?? [0.5, 1, 2, 4];
	const iterations = options.iterations ?? 150;
	const centre = [...start.weights, ...EXTRA_CENTRE];
	const earlier = score(words, start).filter((r) => r.at < cutoff);
	// The prior strength is chosen on the last fifth of the earlier period, fitted on the rest.
	const validation = cutoffOf(earlier);
	let best = { gamma: 1, loss: Infinity };
	if (gammas.length > 1 && Number.isFinite(validation))
		for (const gamma of gammas) {
			const trial = optimise(words, centre, start, validation, gamma, iterations);
			const held = score(words, trial).filter((r) => r.at >= validation && r.at < cutoff);
			const loss = held.reduce((sum, r) => sum + logLoss(r), 0);
			if (loss < best.loss) best = { gamma, loss };
		}
	else best.gamma = gammas[0] ?? 1;
	return {
		set: optimise(words, centre, start, cutoff, best.gamma, iterations),
		gamma: best.gamma,
		iterations
	};
}

/** Projected Adam on standardised parameters z = (θ − centre) / σ, central-difference gradients. */
function optimise(
	words: FitWord[],
	centre: number[],
	start: ParameterSet,
	cutoff: number,
	gamma: number,
	iterations: number
): ParameterSet {
	const n = centre.length;
	const toTheta = (z: number[]) =>
		z.map((zi, i) => Math.min(Math.max(centre[i] + SIGMA[i] * zi, BOUNDS[i][0]), BOUNDS[i][1]));
	const toZ = (theta: number[]) => theta.map((t, i) => (t - centre[i]) / SIGMA[i]);
	const objective = (z: number[]) => {
		const set = setOf(toTheta(z), start.retention);
		let loss = 0;
		for (const row of score(words, set)) if (row.at < cutoff) loss += logLoss(row);
		const prior = z.reduce((sum, zi) => sum + zi * zi, 0) / 2;
		return loss + gamma * prior;
	};
	let z = toZ(vectorOf(start));
	const m = new Array(n).fill(0);
	const v = new Array(n).fill(0);
	const [rate, beta1, beta2, h] = [0.05, 0.9, 0.999, 1e-4];
	for (let k = 1; k <= iterations; k++) {
		const gradient = z.map((_, i) => {
			const up = [...z];
			const down = [...z];
			up[i] += h;
			down[i] -= h;
			return (objective(up) - objective(down)) / (2 * h);
		});
		let moved = 0;
		const next = z.map((zi, i) => {
			m[i] = beta1 * m[i] + (1 - beta1) * gradient[i];
			v[i] = beta2 * v[i] + (1 - beta2) * gradient[i] ** 2;
			const step = (rate * (m[i] / (1 - beta1 ** k))) / (Math.sqrt(v[i] / (1 - beta2 ** k)) + 1e-8);
			moved = Math.max(moved, Math.abs(step));
			return zi - step;
		});
		// Back inside the bounds.
		z = toZ(toTheta(next));
		if (moved < 1e-5) break;
	}
	return setOf(toTheta(z), start.retention);
}

/** A seeded generator, so the bootstrap is the same everywhere (mulberry32). */
function random(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export interface Comparison {
	count: number;
	/** Mean log-loss difference, candidate minus current: below 0 is better. */
	difference: number | null;
	interval: [number, number] | null;
	verdict: 'better' | 'not better' | 'too little data';
}

/** Paired later-period comparison of one outcome type, bootstrapped by word. */
export function compare(
	candidate: Scored[],
	current: Scored[],
	type: Scored['type'],
	cutoff: number
): Comparison {
	const pairs: { word: number; difference: number }[] = [];
	candidate.forEach((row, i) => {
		if (row.type !== type || row.at < cutoff) return;
		pairs.push({ word: row.word, difference: logLoss(row) - logLoss(current[i]) });
	});
	if (pairs.length < MIN_OUTCOMES)
		return { count: pairs.length, difference: null, interval: null, verdict: 'too little data' };
	const byWord = new Map<number, number[]>();
	for (const p of pairs) byWord.set(p.word, [...(byWord.get(p.word) ?? []), p.difference]);
	const groups = [...byWord.values()];
	/** The mean over every outcome of these words, each word contributing all of its own. */
	const mean = (wordsDrawn: number[][]) => {
		let sum = 0;
		let count = 0;
		for (const differences of wordsDrawn)
			for (const difference of differences) {
				sum += difference;
				count++;
			}
		return sum / count;
	};
	const next = random(13);
	const means: number[] = [];
	for (let b = 0; b < 2000; b++)
		means.push(mean(groups.map(() => groups[Math.floor(next() * groups.length)])));
	means.sort((a, b) => a - b);
	const interval: [number, number] = [means[50], means[1949]];
	return {
		count: pairs.length,
		difference: mean(groups),
		interval,
		verdict: interval[1] < 0 ? 'better' : 'not better'
	};
}

/**
 * FR-012: applicable only if in-context reading is predicted better with enough outcomes, and cards
 * no worse — judged only when there are enough card outcomes.
 */
export function applicable(inContext: Comparison, card: Comparison): { ok: boolean; why: string } {
	if (inContext.verdict === 'too little data')
		return { ok: false, why: 'too little data while reading' };
	if (inContext.verdict === 'not better') return { ok: false, why: 'did not predict better' };
	if (card.interval && card.interval[0] > 0)
		return { ok: false, why: 'predicted card answers worse' };
	return { ok: true, why: 'predicted better' };
}

function summary(rows: Scored[]) {
	const n = rows.length;
	if (!n) return { count: 0, observed: null, predicted: null, logLoss: null };
	return {
		count: n,
		observed: rows.reduce((sum, r) => sum + r.label, 0) / n,
		predicted: rows.reduce((sum, r) => sum + r.probability, 0) / n,
		logLoss: rows.reduce((sum, r) => sum + logLoss(r), 0) / n
	};
}

function scores(rows: Scored[], cutoff: number) {
	const later = rows.filter((r) => r.at >= cutoff);
	return {
		cardsReading: summary(later.filter((r) => r.type === 'card' && r.skill === 'reading')),
		cardsListening: summary(later.filter((r) => r.type === 'card' && r.skill === 'listening')),
		readingInContext: summary(later.filter((r) => r.type === 'in-context'))
	};
}

/**
 * The whole laptop (and later phone) fit of an export: fit on the earlier period, then score the
 * fitted set beside the set in force on the later one, and say whether it may be applied.
 */
export function fitDataset(value: unknown, options: FitOptions = {}) {
	validateDataset(value);
	const data: TuningDataset = value;
	const usable = data.words.filter((w) => !clockAmbiguous(w.history));
	const words = prepareWords(
		usable.map((w) => ({
			id: w.id,
			history: { ...w.history, answers: new Map(w.history.answers) }
		}))
	);
	const current = baselineSet(
		data.parameters?.weights ?? [...default_w],
		data.parameters?.retention ?? 0.9
	);
	const cutoff = cutoffOf(score(words, current));
	const fitted = fit(words, current, cutoff, options);
	const candidate = score(words, fitted.set);
	const before = score(words, current);
	const inContext = compare(candidate, before, 'in-context', cutoff);
	const card = compare(candidate, before, 'card', cutoff);
	const verdict = applicable(inContext, card);
	const report = {
		cutoff: Number.isFinite(cutoff) ? new Date(cutoff).toISOString() : null,
		words: { exported: data.words.length, used: words.length },
		earlier: {
			cards: before.filter((r) => r.at < cutoff && r.type === 'card').length,
			inContext: before.filter((r) => r.at < cutoff && r.type === 'in-context').length
		},
		fitted: scores(candidate, cutoff),
		current: scores(before, cutoff),
		comparison: { inContext, card },
		applicable: verdict.ok,
		why: verdict.why
	};
	return {
		set: {
			...fitted.set,
			comparedWith: current.id,
			provenance: {
				exportedAt: data.exportedAt,
				gamma: fitted.gamma,
				iterations: fitted.iterations
			},
			report
		},
		report
	};
}
