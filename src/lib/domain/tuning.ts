import { clipParameters, default_w } from 'ts-fsrs';
import type { FsrsParameters } from './anki';
import type { AttentionAnswer } from './encounter';
import { RULE, reviewPredictions, type ReviewPrediction, type WordHistory } from './memory';
import type { ParameterSet } from './fit';

export const TUNING_SCHEDULER = 'ts-fsrs@5.4.2';
/**
 * Rules an export may have been made under; its raw history replays under `RULE`. One from before
 * `evidence-4` has no `rewatchDays`, so it replays as if every sentence was new.
 */
const READABLE_RULES = ['evidence-2', 'evidence-3', RULE];

export interface TuningDataset {
	/** 2 (spec 013): exposures carry `helped`, and words without reviews are included. */
	format: 1 | 2;
	/** The rule it was exported under; it is replayed under the current one. */
	rule: string;
	scheduler: typeof TUNING_SCHEDULER;
	exportedAt: string;
	parameters?: FsrsParameters;
	/** The fitted set in force when exported, if one was (spec 013); `parameters` are its weights. */
	active?: ParameterSet;
	words: {
		id: number;
		history: Omit<WordHistory, 'answers'> & { answers: [number, AttentionAnswer][] };
	}[];
}

function object(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value))
		throw new Error('Expected an object.');
	return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
	if (!Array.isArray(value)) throw new Error('Expected an array.');
	return value;
}
function integer(value: unknown): asserts value is number {
	if (!Number.isSafeInteger(value) || Number(value) < 0)
		throw new Error('Expected a nonnegative integer.');
}
function text(value: unknown): asserts value is string {
	if (typeof value !== 'string' || !value) throw new Error('Expected nonempty text.');
}
function timestamp(value: unknown): void {
	text(value);
	if (!Number.isFinite(Date.parse(value))) throw new Error('Invalid timestamp.');
}

export function validateCandidate(value: unknown): number[] {
	const weights = object(value).weights;
	if (!Array.isArray(weights) || weights.length !== 21 || !weights.every(Number.isFinite)) {
		throw new Error('Candidate must contain 21 finite FSRS-6 weights.');
	}
	const clipped = clipParameters(weights, 1, true);
	if (weights.some((weight, i) => weight !== clipped[i]))
		throw new Error('Candidate weights are outside FSRS-6 bounds.');
	return [...weights];
}

/** Validate a portable file before letting it influence an evaluation. No coercion or repair. */
export function validateDataset(value: unknown): asserts value is TuningDataset {
	const data = object(value);
	if (
		(data.format !== 1 && data.format !== 2) ||
		!READABLE_RULES.includes(data.rule as string) ||
		data.scheduler !== TUNING_SCHEDULER
	) {
		throw new Error('Incompatible dataset format, evidence rule or scheduler version.');
	}
	timestamp(data.exportedAt);
	if (data.parameters !== undefined) {
		const parameters = object(data.parameters);
		validateCandidate(parameters);
		text(parameters.preset);
		if (
			typeof parameters.retention !== 'number' ||
			!(parameters.retention > 0 && parameters.retention < 1)
		) {
			throw new Error('Invalid retention preference.');
		}
	}
	const ids = new Set<number>();
	for (const entry of array(data.words)) {
		const word = object(entry);
		integer(word.id);
		if (ids.has(word.id)) throw new Error('Duplicate word id.');
		ids.add(word.id);
		const h = object(word.history);
		for (const kind of ['marks', 'events', 'exposures'] as const) {
			const positions = new Set<string>();
			for (const item of array(h[kind])) {
				const event = object(item);
				text(event.deviceId);
				integer(event.deviceSeq);
				timestamp(event.at);
				const position = JSON.stringify([event.deviceId, event.deviceSeq]);
				if (positions.has(position)) throw new Error('Duplicate history position.');
				positions.add(position);
				if (event.sessionId !== undefined) integer(event.sessionId);
				if (
					event.modality !== undefined &&
					event.modality !== 'reading' &&
					event.modality !== 'media'
				)
					throw new Error('Invalid modality.');
				if (event.textVisible !== undefined && typeof event.textVisible !== 'boolean')
					throw new Error('Invalid text visibility.');
				if (kind === 'marks') {
					text(event.asserted);
					text(event.provenance);
				}
				if (kind === 'exposures') {
					integer(event.sessionId);
					text(event.modality);
					const days = event.rewatchDays;
					if (days !== undefined && !(typeof days === 'number' && days >= 0 && days < Infinity))
						throw new Error('Invalid days since a sentence was seen.');
				}
				if (kind === 'events') {
					if (!['lookup', 'check', 'review'].includes(String(event.kind)))
						throw new Error('Unexpected word event kind.');
					const detail = object(event.detail);
					if (
						event.kind === 'review' &&
						(!['reading', 'listening'].includes(String(detail.skill)) ||
							![1, 2, 3, 4].includes(Number(detail.grade)) ||
							typeof detail.grade !== 'number')
					)
						throw new Error('Invalid review grade or skill.');
				}
			}
		}
		const sessions = new Set<number>();
		for (const item of array(h.answers)) {
			const answer = array(item);
			integer(answer[0]);
			if (
				answer.length !== 2 ||
				!['all', 'some', 'none', null].includes(answer[1] as AttentionAnswer) ||
				sessions.has(answer[0])
			)
				throw new Error('Invalid attention answer.');
			sessions.add(answer[0]);
		}
	}
}

interface Metrics {
	count: number;
	successes: number;
	observedRecall: number | null;
	meanPrediction: number | null;
	logLoss: number | null;
	brier: number | null;
}
function metrics(rows: ReviewPrediction[]): Metrics {
	let successes = 0,
		predicted = 0,
		loss = 0,
		brier = 0;
	for (const row of rows) {
		const y = row.rating === 1 ? 0 : 1;
		const p = row.probability!;
		const bounded = Math.min(1 - 1e-12, Math.max(1e-12, p));
		successes += y;
		predicted += p;
		loss -= y * Math.log(bounded) + (1 - y) * Math.log(1 - bounded);
		brier += (p - y) ** 2;
	}
	return {
		count: rows.length,
		successes,
		observedRecall: rows.length ? successes / rows.length : null,
		meanPrediction: rows.length ? predicted / rows.length : null,
		logLoss: rows.length ? loss / rows.length : null,
		brier: rows.length ? brier / rows.length : null
	};
}
/** `all`, `reading` and `listening` are card answers; `inContext` is reading in context. */
function period(rows: ReviewPrediction[]) {
	const cards = rows.filter((r) => r.type === 'card');
	return {
		from: rows[0]?.at ?? null,
		to: rows.at(-1)?.at ?? null,
		all: metrics(cards),
		reading: metrics(cards.filter((r) => r.skill === 'reading')),
		listening: metrics(cards.filter((r) => r.skill === 'listening')),
		inContext: metrics(rows.filter((r) => r.type === 'in-context'))
	};
}

/**
 * A word whose history spans devices, or whose clock went back: its order in time is not known,
 * so it is left out of any score.
 */
export function clockAmbiguous(h: Pick<WordHistory, 'marks' | 'events' | 'exposures'>): boolean {
	const ordered = [...h.marks, ...h.events, ...h.exposures].sort(
		(a, b) => a.deviceSeq - b.deviceSeq
	);
	const devices = new Set(ordered.map((e) => e.deviceId));
	return (
		devices.size > 1 ||
		ordered.some((e, i) => i > 0 && Date.parse(e.at) < Date.parse(ordered[i - 1].at))
	);
}

/** The dataset is a retrospective snapshot; it never writes or activates parameters. */
export function evaluateDataset(data: TuningDataset, candidateWeights?: number[]) {
	const baseline: FsrsParameters = data.parameters ?? {
		preset: 'default',
		weights: [...default_w],
		retention: 0.9
	};
	const parameters = candidateWeights
		? {
				...baseline,
				preset: 'candidate',
				weights: validateCandidate({ weights: candidateWeights })
			}
		: baseline;
	const rows: ReviewPrediction[] = [];
	const excluded: Record<string, number> = {};
	const count = (reason: string, n = 1) => {
		excluded[reason] = (excluded[reason] ?? 0) + n;
	};
	let explicit = 0;
	for (const word of data.words) {
		const h: WordHistory = { ...word.history, answers: new Map(word.history.answers) };
		const reviews = h.events.filter((e) => e.kind === 'review').length;
		explicit += reviews;
		if (clockAmbiguous(h)) {
			count('ambiguous-clock', reviews);
			continue;
		}
		// A hand-made candidate is judged under today's rule; the export's own set under its strengths.
		const predictions = reviewPredictions(
			h,
			parameters,
			candidateWeights ? undefined : data.active?.strengths
		);
		const replayed = predictions.filter((row) => row.type === 'card').length;
		if (reviews > replayed) count('not-replayed-by-rule', reviews - replayed);
		for (const row of predictions) {
			if (row.excluded) count(row.excluded);
			else if (
				row.probability === null ||
				!Number.isFinite(row.probability) ||
				row.probability < 0 ||
				row.probability > 1
			)
				throw new Error('Scheduler produced an invalid prediction.');
			else rows.push(row);
		}
	}
	rows.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
	// Keep ties on the later side. A single outcome supplies no separate evaluation period.
	const cutoff = rows.length > 1 ? Date.parse(rows[Math.floor(rows.length * 0.8)].at) : Infinity;
	const earlier = rows.filter((r) => Date.parse(r.at) < cutoff);
	const later = rows.filter((r) => Date.parse(r.at) >= cutoff);
	return {
		format: data.format,
		rule: data.rule,
		scheduler: data.scheduler,
		exportedAt: data.exportedAt,
		parameters,
		words: data.words.length,
		explicit,
		eligible: rows.length,
		excluded,
		seeded: rows.filter((r) => r.seeded).length,
		development: period(earlier),
		later: period(later),
		limitations: [
			'Exploratory retrospective evaluation; no parameters have been fitted or applied.',
			'Contextual self-reported recall is a proxy for understanding in new contexts.',
			'Current session attention and segmentation are used, not historical online predictions.',
			'Imported seeds are fixed; their Anki review history is not refitted.',
			'Repeated selection on later-period scores overfits that period. Reserve fresh data for confirmation.',
			'Counts alone do not establish enough data to fit 21 weights; inspect failures, skills and interval coverage.'
		]
	};
}

export type TuningReport = ReturnType<typeof evaluateDataset>;
