/**
 * Encounters: what happened while the reader read or watched (spec 007, ADR-0027).
 *
 * Facts, never conclusions: a `lookup`, not "forgotten". What each kind means for memory is the
 * evidence rule's business (memory.ts), which can change without touching a recorded encounter.
 */

import type { DocumentId, LexemeId } from './types';

/** Free text in storage; these are the kinds this build writes. */
export type EncounterKind =
	| 'read'
	| 'played'
	| 'seek'
	| 'lookup'
	| 'check'
	| 'replay'
	| 'translation'
	| 'setting'
	| 'attention'
	| 'review'
	/** Not something the reader did: the parameters an Anki import brought, kept with the history. */
	| 'anki-parameters';

export type Modality = 'reading' | 'media';
export type Skill = 'reading' | 'listening';
export type AttentionAnswer = 'all' | 'some' | 'none' | null;

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

export class InvalidEncounter extends Error {
	name = 'InvalidEncounter';
}

const ATTENTION_ANSWERS = ['all', 'some', 'none', null];

/**
 * Refuse an encounter missing what its kind needs. Unknown kinds pass: a newer build may write
 * them, and a copy from it must still restore.
 */
export function validateEncounter(encounter: Encounter): void {
	const fail = (why: string) => {
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
		case 'lookup':
		case 'check':
			needsWord();
			break;
		case 'read':
			needsRange();
			break;
		case 'played':
			needsRange();
			if (typeof encounter.mediaMs !== 'number' || typeof detail.toMs !== 'number')
				fail('has no media times');
			break;
		case 'review':
			needsWord();
			if (detail.skill !== 'reading' && detail.skill !== 'listening') fail('names no skill');
			if (![1, 2, 3, 4].includes(detail.grade as number)) fail('has no grade from 1 to 4');
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
	}
}
