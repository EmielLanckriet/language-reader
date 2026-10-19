import { describe, it, expect } from 'vitest';
import { validateEncounter, type Encounter } from '../../src/lib/domain/encounter';

// Encounters are earned data (ADR-0027): what a kind requires is checked before anything is
// written, because SQLite cannot check a JSON detail.

const at = '2026-09-27T10:00:00.000Z';
const word = { lexemeId: 7, documentId: 1, fromOffset: 3, toOffset: 5 };

const valid: Encounter[] = [
	{ kind: 'lookup', at, ...word },
	// Spec 017, ADR-0043: why the word was tapped, and whether a listened video could be followed.
	{ kind: 'lookup', at, ...word, detail: { reason: 'sense' } },
	{ kind: 'lookup', at, ...word, detail: { reason: 'curious' } },
	{ kind: 'engagement', at, detail: { mode: 'listened', attentive: 'yes', followable: 'partly' } },
	{ kind: 'engagement', at, detail: { mode: 'listened', attentive: null, followable: null } },
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
	{ kind: 'tap-undone', at, ...word },
	{ kind: 'fsrs-activation', at, detail: { action: 'rollback', set: null } },
	{
		kind: 'fsrs-activation',
		at,
		detail: { action: 'apply', set: { id: 'abc', weights: new Array(21).fill(1) } }
	},
	{ kind: 'engagement', at, detail: { mode: null, attentive: 'partly' } },
	{ kind: 'review', at, ...word, detail: { skill: 'reading', grade: 3 } },
	{ kind: 'review', at, lexemeId: 7, detail: { skill: 'reading', grade: 3 } },
	{ kind: 'something-a-later-build-writes', at },
	// Hardcore mode (spec 014, contracts/hardcore-records.md).
	{ kind: 'hardcore-plan', at, detail: plan() },
	{ kind: 'hardcore-step', at, detail: { part: 0, step: 'drill', at: 'start' } },
	{ kind: 'hardcore-step', at, detail: { part: 2, step: 'watch-after', at: 'end' } },
	{ kind: 'hardcore-watch', at, detail: { session: 4, part: 0, step: 'watch-first' } },
	{ kind: 'review', at, ...word, detail: drilled() }
];

function plan(change: Record<string, unknown> = {}) {
	return {
		start: 'beginning',
		fragment: [0, 9],
		cut: null,
		steps: ['preview', 'watch-first', 'drill', 'watch-after'],
		filters: {},
		order: 'frequency',
		parts: [{ lines: [0, 9], words: [7, 8] }],
		...change
	};
}

function drilled(change: Record<string, unknown> = {}) {
	return { skill: 'reading', grade: 3, hardcore: { part: 0 }, line: [0, 10], ...change };
}

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
	['a tap reason not offered', { kind: 'lookup', at, ...word, detail: { reason: 'bored' } }],
	[
		'a follow answer not offered',
		{ kind: 'engagement', at, detail: { mode: 'listened', attentive: 'yes', followable: 'maybe' } }
	],
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
	['an activation without an action', { kind: 'fsrs-activation', at, detail: { set: null } }],
	[
		'an activation of a set without 21 weights',
		{ kind: 'fsrs-activation', at, detail: { action: 'apply', set: { id: 'a', weights: [1] } } }
	],
	[
		'an undone tap without its word',
		{ kind: 'tap-undone', at, documentId: 1, fromOffset: 3, toOffset: 5 }
	],
	[
		'text visibility that is not a yes or no',
		{ kind: 'lookup', at, ...word, textVisible: 2 as unknown as boolean }
	],
	['no moment', { kind: 'lookup', ...word } as unknown as Encounter],
	['a plan without parts', { kind: 'hardcore-plan', at, detail: plan({ parts: [] }) }],
	[
		'a plan part ending before it starts',
		{ kind: 'hardcore-plan', at, detail: plan({ parts: [{ lines: [5, 2], words: [] }] }) }
	],
	[
		'a plan part whose words are not ids',
		{ kind: 'hardcore-plan', at, detail: plan({ parts: [{ lines: [0, 2], words: ['好'] }] }) }
	],
	['a plan without steps', { kind: 'hardcore-plan', at, detail: plan({ steps: [] }) }],
	['a plan with an unknown step', { kind: 'hardcore-plan', at, detail: plan({ steps: ['nap'] }) }],
	['a step of no part', { kind: 'hardcore-step', at, detail: { step: 'drill', at: 'start' } }],
	[
		'a step not offered',
		{ kind: 'hardcore-step', at, detail: { part: 0, step: 'nap', at: 'start' } }
	],
	[
		'a step neither starting nor ending',
		{ kind: 'hardcore-step', at, detail: { part: 0, step: 'drill', at: 'middle' } }
	],
	[
		'a watch link without its session',
		{ kind: 'hardcore-watch', at, detail: { part: 0, step: 'watch-first' } }
	],
	[
		'a drill review without its part',
		{ kind: 'review', at, ...word, detail: drilled({ hardcore: {} }) }
	],
	[
		'a drill review without its line',
		{ kind: 'review', at, ...word, detail: drilled({ line: undefined }) }
	],
	[
		'a drill review whose line misses the word',
		{ kind: 'review', at, ...word, detail: drilled({ line: [4, 10] }) }
	]
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
