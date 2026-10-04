import { describe, it, expect } from 'vitest';
import { helpOf, isHelped } from '../../src/lib/domain/helped';

// Where English was on screen in a session (spec 013, ADR-0037): words under it are neither
// understood nor not, so the rule needs to know exactly which ones those were.

const lines: [number, number][] = [
	[0, 5],
	[6, 12],
	[13, 20]
];
const setting = (name: string, value: unknown) => ({ kind: 'setting', detail: { name, value } });

describe('English shown in a session', () => {
	it('covers a revealed line by its offsets, and only that line', () => {
		const help = helpOf(
			[{ kind: 'translation', fromOffset: 6, toOffset: 12, detail: { line: 1 } }],
			lines
		);
		expect(isHelped(help, 7, 9)).toBe(true);
		expect(isHelped(help, 0, 2)).toBe(false);
		expect(isHelped(help, 14, 16)).toBe(false);
	});

	it('maps a reveal recorded with only its line to that line', () => {
		const help = helpOf([{ kind: 'translation', detail: { line: 2, source: 'quick' } }], lines);
		expect(isHelped(help, 14, 16)).toBe(true);
		expect(isHelped(help, 7, 9)).toBe(false);
	});

	it('covers a translated sentence given by its range', () => {
		const help = helpOf(
			[{ kind: 'translation', fromOffset: 0, toOffset: 5, detail: { source: 'google-translate' } }],
			lines
		);
		expect(isHelped(help, 1, 3)).toBe(true);
	});

	it('covers the whole session when the stage showed English unblurred at any moment', () => {
		for (const encounters of [
			[setting('stage', true), setting('blurEnglish', false)],
			[setting('blurEnglish', true), setting('blurEnglish', false), setting('blurEnglish', true)],
			[setting('showAllEnglish', true)]
		])
			expect(isHelped(helpOf(encounters, lines), 14, 16)).toBe(true);
	});

	it('does not count blur off in the list view, where English shows only on reveal', () => {
		const help = helpOf([setting('stage', false), setting('blurEnglish', false)], lines);
		expect(isHelped(help, 14, 16)).toBe(false);
	});

	it('counts English unblurred before the list view was chosen: it was on screen then', () => {
		// The stage is the default view, so a blur-off arriving first was seen there (audit 2026-10-04).
		const help = helpOf([setting('blurEnglish', false), setting('stage', false)], lines);
		expect(isHelped(help, 14, 16)).toBe(true);
	});

	it('counts a session with no record of its settings as blurred', () => {
		expect(isHelped(helpOf([], lines), 0, 2)).toBe(false);
	});
});
