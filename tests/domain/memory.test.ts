import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
	evidenceFor,
	memoryOf,
	recall,
	colourBand,
	type WordHistory,
	type HistoryEvent,
	type Exposure,
	type Mark
} from '../../src/lib/domain/memory';

// The evidence rule `evidence-1` (research R5, contracts/evidence-rule.md): how a word's history
// counts for its reading and listening memory. One example per row and per limit of the table.

const AGAIN = 1;
const HARD = 2;
const GOOD = 3;

let seq = 0;
const at = (day: number, hour = 10) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();
const ordered = (when: string) => ({ deviceId: 'd', deviceSeq: ++seq, at: when });

const lookup = (
	session: number,
	when = at(1),
	media = false,
	textVisible = true
): HistoryEvent => ({
	...ordered(when),
	kind: 'lookup',
	sessionId: session,
	modality: media ? 'media' : 'reading',
	textVisible: media ? textVisible : undefined,
	detail: {}
});
const check = (
	session: number,
	media: boolean,
	textVisible: boolean,
	when = at(1)
): HistoryEvent => ({
	...lookup(session, when, media, textVisible),
	kind: 'check',
	detail: { via: 'knew' }
});
const review = (grade: number, when = at(1)): HistoryEvent => ({
	...ordered(when),
	kind: 'review',
	detail: { skill: 'reading', grade }
});
const seen = (session: number, when = at(1), media = false, textVisible = true): Exposure => ({
	...ordered(when),
	sessionId: session,
	modality: media ? 'media' : 'reading',
	textVisible: media ? textVisible : undefined
});
const mark = (asserted: string, provenance = 'manual', when = at(1)): Mark => ({
	...ordered(when),
	asserted,
	provenance
});
const seed = (when = at(1)) =>
	mark('anki-mature', `anki 2026-09-27T20:00:00Z s=40 d=5 r=${when} decay=0.2641`, when);

function history(parts: Partial<WordHistory>): WordHistory {
	return { marks: [], events: [], exposures: [], answers: new Map(), ...parts };
}

const ratings = (h: WordHistory) => {
	const found = evidenceFor(h);
	return {
		reading: found.reading.evidence.map((e) => e.rating),
		listening: found.listening.evidence.map((e) => e.rating)
	};
};

describe('evidence-1', () => {
	it('counts a lookup as a failure in both skills', () => {
		expect(ratings(history({ events: [lookup(1)] }))).toEqual({
			reading: [AGAIN],
			listening: [AGAIN]
		});
	});

	it('counts lookups of a word in one session once', () => {
		const h = history({ events: [lookup(1), lookup(1, at(1, 11)), lookup(2, at(3))] });
		expect(ratings(h)).toEqual({ reading: [AGAIN, AGAIN], listening: [AGAIN, AGAIN] });
	});

	it('counts a check as a weak success in the skill it was made in', () => {
		expect(ratings(history({ events: [check(1, false, true)] }))).toEqual({
			reading: [HARD],
			listening: []
		});
		expect(ratings(history({ events: [check(1, true, false)] }))).toEqual({
			reading: [],
			listening: [HARD]
		});
		expect(ratings(history({ events: [check(1, true, true)] }))).toEqual({
			reading: [HARD],
			listening: []
		});
	});

	it('counts checks of a word in one session once', () => {
		const h = history({ events: [check(1, false, true), check(1, false, true, at(1, 11))] });
		expect(ratings(h).reading).toEqual([HARD]);
	});

	it('counts a review as its grade in its skill', () => {
		expect(ratings(history({ events: [review(GOOD)] }))).toEqual({
			reading: [GOOD],
			listening: []
		});
	});

	describe('a word met without a lookup', () => {
		const known = lookup(9, at(1));
		const answered = (answer: 'all' | 'some' | null) => new Map([[1, answer]]);

		it('is a weak success when the reader said they tapped everything', () => {
			const h = history({ events: [known], exposures: [seen(1, at(3))], answers: answered('all') });
			expect(ratings(h).reading).toEqual([AGAIN, HARD]);
		});

		it('counts for nothing under any other answer, or none', () => {
			for (const answer of ['some', null] as const) {
				const h = history({
					events: [known],
					exposures: [seen(1, at(3))],
					answers: answered(answer)
				});
				expect(ratings(h).reading).toEqual([AGAIN]);
			}
			expect(ratings(history({ events: [known], exposures: [seen(1, at(3))] })).reading).toEqual([
				AGAIN
			]);
		});

		it('counts for nothing when the word had no memory yet', () => {
			const h = history({ exposures: [seen(1, at(3))], answers: answered('all') });
			expect(ratings(h)).toEqual({ reading: [], listening: [] });
		});

		it('counts once a day', () => {
			const h = history({
				events: [known],
				exposures: [seen(1, at(3, 9)), seen(1, at(3, 20)), seen(1, at(4, 9))],
				answers: answered('all')
			});
			expect(ratings(h).reading).toEqual([AGAIN, HARD, HARD]);
		});

		it('does not count in a session the word was looked up in', () => {
			const h = history({
				events: [known, lookup(1, at(3))],
				exposures: [seen(1, at(3))],
				answers: answered('all')
			});
			expect(ratings(h).reading).toEqual([AGAIN, AGAIN]);
		});

		it('counts for listening when heard with the text hidden', () => {
			const h = history({
				events: [known],
				exposures: [seen(1, at(3), true, false)],
				answers: answered('all')
			});
			expect(ratings(h)).toEqual({ reading: [AGAIN], listening: [AGAIN, HARD] });
		});
	});

	describe('an Anki import', () => {
		it('seeds the reading memory', () => {
			const found = evidenceFor(history({ marks: [seed(at(1))] }));
			expect(found.reading.seed).toMatchObject({ stability: 40, difficulty: 5 });
			expect(found.listening.seed).toBeUndefined();
		});

		it('supersedes what happened before its last review', () => {
			const h = history({ marks: [seed(at(5))], events: [lookup(1, at(2)), lookup(2, at(7))] });
			expect(ratings(h).reading).toEqual([AGAIN]);
		});

		it('is ignored once the word has been reviewed in the Reader', () => {
			const h = history({ events: [review(GOOD, at(2))], marks: [seed(at(1))] });
			h.marks[0] = { ...h.marks[0], deviceSeq: h.events[0].deviceSeq + 1 };
			expect(evidenceFor(h).reading.seed).toBeUndefined();
		});

		it('is withdrawn by undoing it', () => {
			const h = history({
				marks: [seed(), mark('(none)', 'anki 2026-09-27T20:00:00Z undo', at(2))]
			});
			expect(evidenceFor(h).reading.seed).toBeUndefined();
		});
	});

	it('gives an ignored word no memory, and gives it back when it is marked again', () => {
		const ignored = history({ events: [lookup(1)], marks: [mark('ignored', 'manual', at(2))] });
		expect(memoryOf(ignored)).toEqual({});
		ignored.marks.push(mark('learning', 'manual', at(3)));
		expect(memoryOf(ignored).reading).toBeDefined();
	});

	it('makes a card of a lookup, an Anki word, or a word marked learning, and nothing else', () => {
		expect(evidenceFor(history({ events: [lookup(1)] })).card).toBe(true);
		expect(evidenceFor(history({ marks: [seed()] })).card).toBe(true);
		expect(evidenceFor(history({ marks: [mark('learning')] })).card).toBe(true);
		expect(evidenceFor(history({ events: [check(1, false, true)] })).card).toBe(false);
		expect(evidenceFor(history({ marks: [mark('known')] })).card).toBe(false);
	});

	it('has no memory without evidence', () => {
		expect(memoryOf(history({ exposures: [seen(1)] }))).toEqual({});
	});

	it('folds into a memory whose recall falls with time and drops after a lookup', () => {
		const seeded = memoryOf(history({ marks: [seed(at(1))] })).reading!;
		expect(seeded.stability).toBeCloseTo(40);
		const soon = recall(seeded, new Date(at(2)));
		const later = recall(seeded, new Date(at(28)));
		expect(soon).toBeGreaterThan(later);
		const lapsed = memoryOf(history({ marks: [seed(at(1))], events: [lookup(1, at(2))] })).reading!;
		expect(lapsed.stability).toBeLessThan(seeded.stability);
		expect(lapsed.lapses).toBe(1);
	});

	it('depends on history order, not on the order the lists arrive in', () => {
		const h = history({
			marks: [seed(at(1)), mark('ignored', 'manual', at(2)), mark('learning', 'manual', at(4))],
			events: [lookup(1, at(3)), check(2, false, true, at(5)), review(GOOD, at(8))],
			exposures: [seen(3, at(10))],
			answers: new Map([[3, 'all']])
		});
		const expected = memoryOf(h);
		fc.assert(
			fc.property(fc.array(fc.nat()), (keys) => {
				const shuffle = <T>(list: T[]) =>
					list
						.map((item, i) => [keys[i % Math.max(keys.length, 1)] ?? i, item] as const)
						.sort((a, b) => a[0] - b[0])
						.map(([, item]) => item);
				const shuffled = {
					...h,
					events: shuffle(h.events),
					marks: shuffle(h.marks),
					exposures: shuffle(h.exposures)
				};
				expect(memoryOf(shuffled)).toEqual(expected);
			})
		);
	});

	it('colours a word still being learned as fragile, however fresh the lookup', () => {
		const looked = memoryOf(history({ events: [lookup(1, at(1))] })).reading!;
		expect(recall(looked, new Date(at(1)))).toBeGreaterThan(0.99);
		expect(colourBand(looked, new Date(at(1)))).toBe(4);
		const solid = memoryOf(history({ marks: [seed(at(1))] })).reading!;
		expect(colourBand(solid, new Date(at(2)))).toBe(1);
	});
});
