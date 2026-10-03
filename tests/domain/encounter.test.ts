import { describe, it, expect } from 'vitest';
import { validateEncounter, type Encounter } from '../../src/lib/domain/encounter';

// Encounters are earned data (ADR-0027): what a kind requires is checked before anything is
// written, because SQLite cannot check a JSON detail.

const at = '2026-09-27T10:00:00.000Z';
const word = { lexemeId: 7, documentId: 1, fromOffset: 3, toOffset: 5 };

const valid: Encounter[] = [
	{ kind: 'lookup', at, ...word },
	{ kind: 'check', at, ...word },
	{ kind: 'read', at, documentId: 1, fromOffset: 0, toOffset: 40 },
	{
		kind: 'played',
		at,
		documentId: 1,
		fromOffset: 0,
		toOffset: 12,
		mediaMs: 0,
		detail: { toMs: 5000 }
	},
	{ kind: 'seek', at, documentId: 1, detail: { fromMs: 5000, toMs: 35000 } },
	{ kind: 'replay', at, documentId: 1, detail: { line: 3, toPrevious: false } },
	{ kind: 'translation', at, documentId: 1, detail: { line: 3, source: 'quick' } },
	{ kind: 'setting', at, detail: { name: 'speed', value: 0.75 } },
	{ kind: 'attention', at, detail: { answer: 'all' } },
	{ kind: 'attention', at, detail: { answer: null } },
	{ kind: 'engagement', at, detail: { mode: 'listened', attentive: 'yes' } },
	{ kind: 'engagement', at, detail: { mode: null, attentive: 'partly' } },
	{ kind: 'review', at, ...word, detail: { skill: 'reading', grade: 3 } },
	{ kind: 'review', at, lexemeId: 7, detail: { skill: 'reading', grade: 3 } },
	{ kind: 'something-a-later-build-writes', at }
];

const invalid: [string, Encounter][] = [
	[
		'a read range longer than 1000',
		{ kind: 'read', at, documentId: 1, fromOffset: 0, toOffset: 1001 }
	],
	['a lookup without its word', { kind: 'lookup', at, documentId: 1, fromOffset: 3, toOffset: 5 }],
	['a check without offsets', { kind: 'check', at, lexemeId: 7, documentId: 1 }],
	['a read range without a document', { kind: 'read', at, fromOffset: 0, toOffset: 4 }],
	[
		'a range that ends before it starts',
		{ kind: 'read', at, documentId: 1, fromOffset: 9, toOffset: 4 }
	],
	[
		'a played range without its end time',
		{ kind: 'played', at, documentId: 1, fromOffset: 0, toOffset: 4, mediaMs: 0 }
	],
	['a review without a grade', { kind: 'review', at, ...word, detail: { skill: 'reading' } }],
	['a review graded 5', { kind: 'review', at, ...word, detail: { skill: 'reading', grade: 5 } }],
	['a review of no skill', { kind: 'review', at, ...word, detail: { grade: 3 } }],
	['a review of no word', { kind: 'review', at, detail: { skill: 'reading', grade: 3 } }],
	[
		'a review whose sentence has no offsets',
		{ kind: 'review', at, lexemeId: 7, documentId: 1, detail: { skill: 'reading', grade: 3 } }
	],
	['an attention answer not offered', { kind: 'attention', at, detail: { answer: 'mostly' } }],
	['an attention without an answer field', { kind: 'attention', at, detail: {} }],
	[
		'an engagement mode not offered',
		{ kind: 'engagement', at, detail: { mode: 'skimmed', attentive: null } }
	],
	[
		'an engagement attentiveness not offered',
		{ kind: 'engagement', at, detail: { mode: 'watched', attentive: true } }
	],
	['an engagement without its fields', { kind: 'engagement', at, detail: {} }],
	[
		'text visibility that is not a yes or no',
		{ kind: 'lookup', at, ...word, textVisible: 2 as unknown as boolean }
	],
	['no moment', { kind: 'lookup', ...word } as unknown as Encounter]
];

describe('validating an encounter', () => {
	it.each(valid.map((encounter) => [encounter.kind, encounter]))(
		'accepts %s',
		(_kind, encounter) => {
			expect(() => validateEncounter(encounter)).not.toThrow();
		}
	);

	it.each(invalid)('refuses %s', (_why, encounter) => {
		expect(() => validateEncounter(encounter)).toThrow();
	});
});
