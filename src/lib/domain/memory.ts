/**
 * A word's memory, derived from its history (spec 007, research R5–R6, contracts/evidence-rule.md).
 *
 * Two steps: the evidence rule turns what happened into FSRS ratings per skill, and ts-fsrs folds
 * them. Nothing here is stored as earned data: the rule is a guess, named so a better one can
 * replace it by recomputing (ADR-0027).
 */

import {
	createEmptyCard,
	fsrs,
	generatorParameters,
	State,
	type Card,
	type FSRS,
	type Grade
} from 'ts-fsrs';
import { ankiSeedOf, isFromAnki, type AnkiSeed, type FsrsParameters } from './anki';
import type { AttentionAnswer, Modality, Skill } from './encounter';
import { RETRACTED } from './state';

export const RULE = 'evidence-2';

/** Position in the history: what orders it. `at` only measures the time between evidence. */
export interface Ordered {
	deviceId: string;
	deviceSeq: number;
	at: string;
}

/** A judgment in the history: a hand mark, or an Anki import and its undo. */
export interface Mark extends Ordered {
	asserted: string;
	provenance: string;
}

/** A lookup, check or review of this word. */
export interface HistoryEvent extends Ordered {
	kind: string;
	sessionId?: number;
	modality?: Modality;
	textVisible?: boolean;
	detail: Record<string, unknown>;
}

/** A read or played stretch that covered one of this word's tokens. */
export interface Exposure extends Ordered {
	sessionId: number;
	modality: Modality;
	textVisible?: boolean;
}

export interface WordHistory {
	marks: Mark[];
	events: HistoryEvent[];
	exposures: Exposure[];
	/** Each session's attention answer; a session missing here was not answered. */
	answers: Map<number, AttentionAnswer>;
}

export interface Evidence {
	at: string;
	rating: Grade;
	/** Present only for an actual answer, never an inferred encounter rating. */
	review?: Pick<Ordered, 'deviceId' | 'deviceSeq'>;
}

export interface SkillEvidence {
	seed?: AnkiSeed;
	evidence: Evidence[];
}

export interface WordEvidence {
	/** A card-creating event happened (R8): a lookup, an Anki seed, a hand mark of learning. */
	card: boolean;
	reading: SkillEvidence;
	listening: SkillEvidence;
}

export interface Memory {
	stability: number;
	difficulty: number;
	state: State;
	lastAt: string;
	due: string;
	reps: number;
	lapses: number;
	card: boolean;
	reviewed: boolean;
	/** `anki`, or `anki-undated` when the import did not know the last review (format 1). */
	seeded?: string;
}

const AGAIN: Grade = 1;
const HARD: Grade = 2;
const GOOD: Grade = 3;

function byHistory(a: Ordered, b: Ordered): number {
	if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
	return a.deviceSeq - b.deviceSeq;
}

/** A check or an exposure counts for listening only when the words were heard with the text hidden. */
function skillOf(item: { modality?: Modality; textVisible?: boolean }): Skill {
	return item.modality === 'media' && item.textVisible === false ? 'listening' : 'reading';
}

/**
 * What `evidence-2` makes of one word's history (research R5). It differs from `evidence-1` in one
 * row, on the reader's word (2026-09-27): a word met untapped in a session answered "I tapped every
 * word I didn't know" is a Good, not a Hard, and it counts even for a word with no memory yet —
 * which then starts one, without becoming a card.
 */
export function evidenceFor(history: WordHistory): WordEvidence {
	const marks = [...history.marks].sort(byHistory);
	const events = [...history.events].sort(byHistory);
	const none: WordEvidence = {
		card: false,
		reading: { evidence: [] },
		listening: { evidence: [] }
	};

	const current = marks.at(-1)?.asserted;
	if (current === 'ignored') return none;

	// The Anki seed: the last import's, unless undone, and none imported after an in-app review.
	const firstReview = events.find((event) => event.kind === 'review');
	let seed: AnkiSeed | undefined;
	for (const mark of marks) {
		if (!isFromAnki(mark.provenance)) continue;
		if (firstReview && byHistory(mark, firstReview) > 0) continue;
		seed = mark.asserted === RETRACTED ? undefined : ankiSeedOf(mark.provenance);
	}

	const lookedIn = new Set(
		events
			.filter(
				(event) =>
					(event.kind === 'lookup' || event.kind === 'check') && event.sessionId !== undefined
			)
			.map((event) => event.sessionId)
	);
	const found: WordEvidence = {
		card:
			seed !== undefined ||
			events.some((event) => event.kind === 'lookup' || event.kind === 'review') ||
			marks.some((mark) => mark.asserted === 'learning'),
		reading: { seed, evidence: [] },
		listening: { evidence: [] }
	};
	const counted = new Set<string>();
	const once = (key: string) => (counted.has(key) ? false : (counted.add(key), true));

	type Item = { event?: HistoryEvent; exposure?: Exposure };
	const stream: Item[] = [
		...events.map((event) => ({ event })),
		...history.exposures.map((exposure) => ({ exposure }))
	].sort((a: Item, b: Item) => byHistory((a.event ?? a.exposure)!, (b.event ?? b.exposure)!));

	for (const { event, exposure } of stream) {
		const item = (event ?? exposure)!;
		if (seed && item.at <= seed.lastReview) continue;
		const session = event?.sessionId ?? `none-${item.deviceId}-${item.deviceSeq}`;

		if (event?.kind === 'lookup') {
			if (!once(`lookup ${session}`)) continue;
			found.reading.evidence.push({ at: event.at, rating: AGAIN });
			found.listening.evidence.push({ at: event.at, rating: AGAIN });
		} else if (event?.kind === 'check') {
			if (!once(`check ${session}`)) continue;
			found[skillOf(event)].evidence.push({ at: event.at, rating: HARD });
		} else if (event?.kind === 'review') {
			const skill = event.detail.skill as Skill;
			found[skill].evidence.push({
				at: event.at,
				rating: event.detail.grade as Grade,
				review: { deviceId: event.deviceId, deviceSeq: event.deviceSeq }
			});
		} else if (exposure) {
			const skill = skillOf(exposure);
			if (history.answers.get(exposure.sessionId) !== 'all') continue;
			if (lookedIn.has(exposure.sessionId)) continue;
			if (!once(`seen ${skill} ${exposure.at.slice(0, 10)}`)) continue;
			found[skill].evidence.push({ at: exposure.at, rating: GOOD });
		}
	}
	return found;
}

const schedulers = new Map<string, FSRS>();

function scheduler(parameters?: FsrsParameters, cache = true): FSRS {
	const key = parameters ? JSON.stringify(parameters) : 'default';
	let made = cache ? schedulers.get(key) : undefined;
	if (!made) {
		// Fuzz off: a replay must be deterministic (SC-007). Short-term on: an Again comes back in minutes.
		made = fsrs(
			generatorParameters({
				enable_fuzz: false,
				enable_short_term: true,
				...(parameters ? { w: parameters.weights, request_retention: parameters.retention } : {})
			})
		);
		if (cache) schedulers.set(key, made);
	}
	return made;
}

/** The rule and the parameters together: what a stored memory has to be recomputed under. */
export function ruleKey(parameters?: FsrsParameters): string {
	if (!parameters) return `${RULE}/default`;
	const weights = parameters.weights.map((w) => w.toFixed(4)).join(',');
	return `${RULE}/${parameters.preset}:${parameters.retention}:${weights}`;
}

const DAY_MS = 86_400_000;

function seededCard(f: FSRS, seed: AnkiSeed): Card {
	const last = new Date(seed.lastReview);
	return {
		...createEmptyCard(last),
		stability: seed.stability,
		difficulty: seed.difficulty,
		state: State.Review,
		last_review: last,
		due: new Date(last.getTime() + f.next_interval(seed.stability, 0) * DAY_MS),
		reps: 1
	};
}

/** ts-fsrs over one skill's evidence; undefined without seed or evidence. */
function fold(
	f: FSRS,
	skill: SkillEvidence,
	observe?: (evidence: Evidence, card: Card | undefined, now: Date, dated: boolean) => void
): Card | undefined {
	let card = skill.seed ? seededCard(f, skill.seed) : undefined;
	let latest = card?.last_review?.getTime() ?? -Infinity;
	let dated = skill.seed?.dateKnown ?? true;
	for (const evidence of skill.evidence) {
		const { at, rating } = evidence;
		// History order decides; a clock that went back only shortens nothing to below zero.
		latest = Math.max(latest, new Date(at).getTime());
		const now = new Date(latest);
		observe?.(evidence, card, now, dated);
		card = f.next(card ?? createEmptyCard(now), now, rating).card;
		dated = true;
	}
	return card;
}

export interface ReviewPrediction {
	deviceId: string;
	deviceSeq: number;
	at: string;
	skill: Skill;
	rating: Grade;
	probability: number | null;
	seeded: boolean;
	excluded?: 'no-prior-memory' | 'undated-seed' | 'short-delay';
}

/** Retrospective evaluation under the current rule; measure BEFORE applying each answer. */
export function reviewPredictions(
	history: WordHistory,
	parameters?: FsrsParameters
): ReviewPrediction[] {
	const found = evidenceFor(history);
	const f = scheduler(parameters, false);
	const predictions: ReviewPrediction[] = [];
	for (const skill of ['reading', 'listening'] as const) {
		fold(f, found[skill], (evidence, card, now, dated) => {
			if (!evidence.review) return;
			const excluded = !card?.last_review
				? 'no-prior-memory'
				: !dated
					? 'undated-seed'
					: now.getTime() - card.last_review.getTime() < DAY_MS
						? 'short-delay'
						: undefined;
			predictions.push({
				...evidence.review,
				at: evidence.at,
				skill,
				rating: evidence.rating,
				probability: excluded ? null : f.get_retrievability(card!, now, false),
				seeded: found[skill].seed !== undefined,
				...(excluded ? { excluded } : {})
			});
		});
	}
	return predictions;
}

/** A word's memory in each skill it has one in. */
export function memoryOf(
	history: WordHistory,
	parameters?: FsrsParameters
): Partial<Record<Skill, Memory>> {
	const found = evidenceFor(history);
	const f = scheduler(parameters);
	const memory: Partial<Record<Skill, Memory>> = {};
	for (const skill of ['reading', 'listening'] as const) {
		const card = fold(f, found[skill]);
		if (!card) continue;
		const seed = found[skill].seed;
		memory[skill] = {
			stability: card.stability,
			difficulty: card.difficulty,
			state: card.state,
			lastAt: (card.last_review ?? card.due).toISOString(),
			due: card.due.toISOString(),
			reps: card.reps,
			lapses: card.lapses,
			card: skill === 'reading' && found.card,
			reviewed: history.events.some(
				(event) => event.kind === 'review' && event.detail.skill === skill
			),
			...(seed ? { seeded: seed.dateKnown ? 'anki' : 'anki-undated' } : {})
		};
	}
	return memory;
}

/** Today's chance of recall. */
export function recall(memory: Memory, now: Date, parameters?: FsrsParameters): number {
	const card: Card = {
		...createEmptyCard(new Date(memory.lastAt)),
		stability: memory.stability,
		difficulty: memory.difficulty,
		state: memory.state,
		last_review: new Date(memory.lastAt),
		due: new Date(memory.due),
		reps: memory.reps,
		lapses: memory.lapses
	};
	return scheduler(parameters).get_retrievability(card, now, false);
}

/**
 * The band a word is coloured in (research R7): 1 at 95 % or more, 2 from 85 %, 3 from 70 %, 4 below.
 * Four, because four read apart at a glance; the thresholds straddle the 90 % a review aims at.
 */
export function recallBand(chance: number): 1 | 2 | 3 | 4 {
	if (chance >= 0.95) return 1;
	if (chance >= 0.85) return 2;
	if (chance >= 0.7) return 3;
	return 4;
}

/**
 * The band a word is shown in. A word FSRS is still learning or relearning is fragile whatever its
 * recall: right after a lookup recall is 100 %, since the answer was just seen, and falls within
 * hours, so a word the reader did not know would otherwise look solid (measured 2026-09-27).
 */
export function colourBand(memory: Memory, now: Date, parameters?: FsrsParameters): 1 | 2 | 3 | 4 {
	if (memory.state === State.Learning || memory.state === State.Relearning) return 4;
	return recallBand(recall(memory, now, parameters));
}
