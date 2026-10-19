/**
 * Encounters: what happened while the reader read or watched (spec 007, ADR-0027).
 *
 * Facts, never conclusions: a `lookup`, not "forgotten". What each kind means for memory is the
 * evidence rule's business (memory.ts), which can change without touching a recorded encounter.
 */

import type { DocumentId, LexemeId } from './types';

/** Free text in storage; these are the kinds this build writes. */
export type EncounterKind =
	| 'anki-example'
	| 'study-time'
	| 'session-end'
	| 'read'
	| 'played'
	| 'seek'
	| 'lookup'
	| 'check'
	| 'replay'
	| 'translation'
	| 'setting'
	| 'attention'
	/** Afterwards, how the reader took a session in; recorded only, never evidence (2026-10-04). */
	| 'engagement'
	/** A tap undone while its sheet was open: no lookup was written (spec 013). */
	| 'tap-undone'
	/** A fitted parameter set put in force, or a return to an earlier one (spec 013, FR-009). */
	| 'fsrs-activation'
	| 'review'
	/** The reader took the session back (ADR-0030): its encounters count for nothing. */
	| 'withdrawn'
	/** Not something the reader did: the parameters an Anki import brought, kept with the history. */
	| 'anki-parameters'
	/** A hardcore session's options and parts, as chosen at its start (spec 014). */
	| 'hardcore-plan'
	/** A hardcore step's start or end. */
	| 'hardcore-step'
	/** In the player's own session: it was opened from this hardcore step. */
	| 'hardcore-watch'
	/** Statuses began here (spec 019): once per library, with what the switch carried and deleted. */
	| 'status-switch';

export const HARDCORE_STEPS = ['preview', 'watch-first', 'drill', 'watch-after'] as const;
export type HardcoreStep = (typeof HARDCORE_STEPS)[number];

export type Modality = 'reading' | 'media';
/** What a session row is of: a sitting with a text or a video, or a hardcore session (spec 014). */
export type SessionKind = Modality | 'hardcore';
export type Skill = 'reading' | 'listening';
export type AttentionAnswer = 'all' | 'some' | 'none' | null;
export interface Engagement {
	mode: 'watched' | 'listened' | null;
	attentive: 'yes' | 'partly' | 'no' | null;
	/** After "Only listened": could the video be followed without the picture (ADR-0043)? */
	followable?: 'yes' | 'partly' | 'no' | null;
}

/** Why a word was tapped, when the reader says (ADR-0043): kept on its lookup, used by nothing yet. */
export const TAP_REASONS = [
	'unknown',
	'sense',
	'split',
	'misheard',
	'subtitles',
	'curious'
] as const;
export type TapReason = (typeof TAP_REASONS)[number];

export interface Encounter {
	kind: EncounterKind | string;
	at: string;
	lexemeId?: LexemeId;
	documentId?: DocumentId;
	fromOffset?: number;
	toOffset?: number;
	mediaMs?: number;
	speed?: number;
	textVisible?: boolean;
	detail?: Record<string, unknown>;
}

/**
 * The longest read or played stretch, in code points. Bounding it lets a word's stretches be found
 * with an index range rather than a scan of the document's history (repository.wordHistory); the
 * recorder splits a longer read range. A played chunk is five seconds of subtitles, far shorter.
 */
export const MAX_RANGE = 1000;

export class InvalidEncounter extends Error {
	name = 'InvalidEncounter';
}

const ATTENTION_ANSWERS = ['all', 'some', 'none', null];
const ENGAGEMENT_MODES = ['watched', 'listened', null];
const ENGAGEMENT_ATTENTION = ['yes', 'partly', 'no', null];

/**
 * Refuse an encounter missing what its kind needs. Unknown kinds pass: a newer build may write
 * them, and a copy from it must still restore.
 */
export function validateEncounter(encounter: Encounter): void {
	const fail = (why: string): never => {
		throw new InvalidEncounter(`A ${encounter.kind} encounter ${why}.`);
	};
	const detail = encounter.detail ?? {};

	if (typeof encounter.at !== 'string' || encounter.at === '') fail('has no moment');
	if (encounter.textVisible !== undefined && typeof encounter.textVisible !== 'boolean')
		fail('has a text visibility that is not yes or no');

	const needsRange = () => {
		if (encounter.documentId === undefined) fail('has no document');
		if (encounter.fromOffset === undefined || encounter.toOffset === undefined)
			fail('has no offsets');
		if (encounter.toOffset! < encounter.fromOffset!) fail('ends before it starts');
	};
	const needsWord = () => {
		needsRange();
		if (encounter.lexemeId === undefined) fail('has no word');
	};

	switch (encounter.kind) {
		case 'study-time':
			if (
				typeof detail.durationMs !== 'number' ||
				!Number.isFinite(detail.durationMs) ||
				detail.durationMs <= 0 ||
				detail.durationMs > 60000
			)
				fail('has no duration between 0 and 60000 ms');
			break;
		case 'lookup':
			needsWord();
			if (detail.reason !== undefined && !TAP_REASONS.includes(detail.reason as TapReason))
				fail('has a reason the reader was not offered');
			break;
		case 'check':
		case 'tap-undone':
			needsWord();
			break;
		case 'read':
			needsRange();
			if (encounter.toOffset! - encounter.fromOffset! > MAX_RANGE)
				fail(`is longer than ${MAX_RANGE}`);
			break;
		case 'played':
			needsRange();
			if (encounter.toOffset! - encounter.fromOffset! > MAX_RANGE)
				fail(`is longer than ${MAX_RANGE}`);
			if (typeof encounter.mediaMs !== 'number' || typeof detail.toMs !== 'number')
				fail('has no media times');
			break;
		case 'review':
			if (
				detail.exampleKey !== undefined &&
				(typeof detail.exampleKey !== 'string' || detail.exampleKey.length > 1500)
			)
				fail('has an invalid example identity');
			// A word in no document (an Anki word never met) is reviewed without a sentence.
			if (encounter.lexemeId === undefined) fail('has no word');
			if (encounter.documentId !== undefined) needsRange();
			if (detail.skill !== 'reading' && detail.skill !== 'listening') fail('names no skill');
			if (![1, 2, 3, 4].includes(detail.grade as number)) fail('has no grade from 1 to 4');
			if (detail.hardcore !== undefined) {
				const { part } = detail.hardcore as { part?: unknown };
				if (typeof part !== 'number') fail('from a drill names no part');
				const line = detail.line as unknown;
				if (
					!Array.isArray(line) ||
					line.length !== 2 ||
					encounter.fromOffset === undefined ||
					!(line[0] <= encounter.fromOffset && encounter.toOffset! <= line[1])
				)
					fail('from a drill has no line around its word');
			}
			break;
		case 'hardcore-plan': {
			const parts = detail.parts as { lines?: unknown; words?: unknown }[] | undefined;
			if (!Array.isArray(parts) || parts.length === 0) fail('has no parts');
			for (const { lines, words } of parts!) {
				if (!Array.isArray(lines) || lines.length !== 2 || !(lines[0] <= lines[1]))
					fail('has a part without its lines');
				if (!Array.isArray(words) || !words.every(Number.isInteger))
					fail('has a part without its words');
			}
			const steps = detail.steps as unknown[] | undefined;
			if (
				!Array.isArray(steps) ||
				steps.length === 0 ||
				!steps.every((step) => HARDCORE_STEPS.includes(step as HardcoreStep))
			)
				fail('has no steps the reader was offered');
			break;
		}
		case 'hardcore-step':
			if (typeof detail.part !== 'number') fail('names no part');
			if (!HARDCORE_STEPS.includes(detail.step as HardcoreStep)) fail('names no step');
			if (detail.at !== 'start' && detail.at !== 'end') fail('neither starts nor ends');
			break;
		case 'hardcore-watch':
			if (typeof detail.session !== 'number') fail('names no hardcore session');
			if (typeof detail.part !== 'number') fail('names no part');
			if (!HARDCORE_STEPS.includes(detail.step as HardcoreStep)) fail('names no step');
			break;
		case 'anki-parameters': {
			const weights = detail.weights;
			if (!Array.isArray(weights) || weights.length !== 21 || !weights.every(Number.isFinite))
				fail('does not have 21 FSRS-6 weights');
			if (typeof detail.retention !== 'number' || detail.retention <= 0 || detail.retention >= 1)
				fail('has no target recall between 0 and 1');
			break;
		}
		case 'attention':
			if (!('answer' in detail) || !ATTENTION_ANSWERS.includes(detail.answer as string | null))
				fail('has no answer the reader was offered');
			break;
		case 'fsrs-activation': {
			if (detail.action !== 'apply' && detail.action !== 'rollback') fail('has no action');
			const set = detail.set as { id?: unknown; weights?: unknown } | null | undefined;
			if (set === undefined) return fail('names no set');
			if (
				set !== null &&
				(typeof set.id !== 'string' ||
					!Array.isArray(set.weights) ||
					set.weights.length !== 21 ||
					!set.weights.every(Number.isFinite))
			)
				fail('has a set without its 21 weights');
			break;
		}
		case 'engagement':
			if (!('mode' in detail) || !ENGAGEMENT_MODES.includes(detail.mode as string | null))
				fail('has no mode the reader was offered');
			if (
				!('attentive' in detail) ||
				!ENGAGEMENT_ATTENTION.includes(detail.attentive as string | null)
			)
				fail('has no attentiveness the reader was offered');
			if (
				'followable' in detail &&
				!ENGAGEMENT_ATTENTION.includes(detail.followable as string | null)
			)
				fail('has a follow answer the reader was not offered');
			break;
	}
}
