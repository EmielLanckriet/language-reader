import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { default_request_retention, default_w, forgetting_curve } from 'ts-fsrs';
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

// The evidence rule `evidence-3` (spec 013, ADR-0037; before it research R5 of spec 007): how a
// word's history counts for its reading and listening memory. One example per row and per limit.

const AGAIN = 1;
const DAY_MS = 86_400_000;
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
const seen = (
	session: number,
	when = at(1),
	media = false,
	textVisible = true,
	helped = false
): Exposure => ({
	...ordered(when),
	sessionId: session,
	modality: media ? 'media' : 'reading',
	textVisible: media ? textVisible : undefined,
	helped
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

	it('counts a check as a tap: a failure in both skills (evidence-3)', () => {
		for (const [media, textVisible] of [
			[false, true],
			[true, false],
			[true, true]
		])
			expect(ratings(history({ events: [check(1, media, textVisible)] }))).toEqual({
				reading: [AGAIN],
				listening: [AGAIN]
			});
	});

	it('counts taps of a word in one session once, checks and lookups alike', () => {
		const h = history({ events: [check(1, false, true), lookup(1, at(1, 11))] });
		expect(ratings(h)).toEqual({ reading: [AGAIN], listening: [AGAIN] });
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

		it('is a success when the reader said they tapped everything', () => {
			const h = history({ events: [known], exposures: [seen(1, at(3))], answers: answered('all') });
			expect(ratings(h).reading).toEqual([AGAIN, GOOD]);
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

		it('starts a memory for a word that had none, without making it a card (evidence-2)', () => {
			const h = history({ exposures: [seen(1, at(3))], answers: answered('all') });
			expect(ratings(h)).toEqual({ reading: [GOOD], listening: [] });
			expect(evidenceFor(h).card).toBe(false);
		});

		it('counts for nothing when English was shown over it, while a tap there still fails', () => {
			const helped = history({
				exposures: [seen(1, at(3), true, true, true)],
				answers: answered('all')
			});
			expect(ratings(helped)).toEqual({ reading: [], listening: [] });
			const tapped = history({
				events: [lookup(1, at(3), true, true)],
				exposures: [seen(1, at(3), true, true, true)],
				answers: answered('all')
			});
			expect(ratings(tapped)).toEqual({ reading: [AGAIN], listening: [AGAIN] });
		});

		it('counts once a day', () => {
			const h = history({
				events: [known],
				exposures: [seen(1, at(3, 9)), seen(1, at(3, 20)), seen(1, at(4, 9))],
				answers: answered('all')
			});
			expect(ratings(h).reading).toEqual([AGAIN, GOOD, GOOD]);
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
			expect(ratings(h)).toEqual({ reading: [AGAIN], listening: [AGAIN, GOOD] });
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

	it('makes a card of a tap, an Anki word, or a word marked learning, and nothing else', () => {
		expect(evidenceFor(history({ events: [lookup(1)] })).card).toBe(true);
		expect(evidenceFor(history({ marks: [seed()] })).card).toBe(true);
		expect(evidenceFor(history({ marks: [mark('learning')] })).card).toBe(true);
		// A check is a tap (evidence-3), so it makes a card like a lookup.
		expect(evidenceFor(history({ events: [check(1, false, true)] })).card).toBe(true);
		expect(evidenceFor(history({ marks: [mark('known')] })).card).toBe(false);
	});

	it('keeps a retired word’s memory but makes it no card, until it is marked again', () => {
		const tapped = history({ marks: [seed()], events: [lookup(1, at(3))] });
		const known = history({
			exposures: [seen(1, at(3)), seen(2, at(5))],
			answers: new Map([
				[1, 'all'],
				[2, 'all']
			])
		});
		for (const h of [tapped, known]) {
			const before = memoryOf(h).reading!;
			h.marks.push(mark('retired', 'manual', at(9)));
			const after = memoryOf(h).reading!;
			expect(after.stability).toBe(before.stability);
			expect(after.card).toBe(false);
			expect(after.known).toBeFalsy();
			h.marks.push(mark('(none)', 'manual', at(10)));
			expect(memoryOf(h).reading).toEqual(before);
		}
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

	// No learning steps (the reader, 2026-10-04): an untapped read on the 4th left 48 words of one
	// video due 10 minutes later, when reading could not credit them again before the next day.
	it('makes a word due when FSRS says, not after a learning step', () => {
		const read = memoryOf(
			history({
				events: [lookup(9, at(1))],
				exposures: [seen(1, at(3))],
				answers: new Map([[1, 'all']])
			})
		).reading!;
		const days = (Date.parse(read.due) - Date.parse(read.lastAt)) / DAY_MS;
		expect(days).toBeCloseTo(read.stability, 6);
		const card = memoryOf(
			history({ events: [review(GOOD, at(1)), review(AGAIN, at(2))] })
		).reading!;
		expect(Date.parse(card.due) - Date.parse(card.lastAt)).toBeGreaterThan(10 * 60_000);
	});

	it('never counts time backwards when the clock went back', () => {
		// The review comes later in the history but carries an earlier clock (a clock set back).
		const first = lookup(1, at(5));
		const skewed = memoryOf(
			history({ events: [first, { ...review(GOOD, at(3)), deviceSeq: first.deviceSeq + 1 }] })
		);
		const same = memoryOf(
			history({ events: [first, { ...review(GOOD, at(5)), deviceSeq: first.deviceSeq + 1 }] })
		);
		expect(skewed).toEqual(same);
	});
});

describe('evidence-3 over any history', () => {
	const item = fc.record({
		day: fc.integer({ min: 1, max: 20 }),
		session: fc.integer({ min: 1, max: 4 }),
		kind: fc.constantFrom('lookup', 'check', 'seen'),
		media: fc.boolean(),
		textVisible: fc.boolean(),
		helped: fc.boolean(),
		// Fixed per item, so that leaving items out does not renumber the rest.
		seq: fc.nat()
	});
	const answer = fc.constantFrom('all', 'some', 'none', null);
	function make(
		items: {
			day: number;
			session: number;
			kind: string;
			media: boolean;
			textVisible: boolean;
			helped: boolean;
			seq: number;
		}[],
		answers: ('all' | 'some' | 'none' | null)[] = []
	) {
		const events: HistoryEvent[] = [];
		const exposures: Exposure[] = [];
		for (const i of items) {
			const fixed = { deviceSeq: i.seq };
			if (i.kind === 'seen')
				exposures.push({
					...seen(i.session, at(i.day), i.media, i.textVisible, i.helped),
					...fixed
				});
			else if (i.kind === 'check')
				events.push({ ...check(i.session, i.media, i.textVisible, at(i.day)), ...fixed });
			else events.push({ ...lookup(i.session, at(i.day), i.media, i.textVisible), ...fixed });
		}
		return history({
			events,
			exposures,
			answers: new Map(answers.map((a, n) => [n + 1, a]))
		});
	}
	it('gives a helped exposure no evidence at all', () => {
		fc.assert(
			fc.property(
				fc.array(item, { size: 'max', maxLength: 30 }),
				fc.array(answer, { minLength: 4, maxLength: 4 }),
				(items, answers) => {
					const without = items.filter((i) => !(i.kind === 'seen' && i.helped));
					expect(evidenceFor(make(items, answers))).toEqual(evidenceFor(make(without, answers)));
				}
			)
		);
	});

	it('makes every memory due when its recall falls to the target', () => {
		fc.assert(
			fc.property(
				fc.array(item, { size: 'max', maxLength: 30 }),
				fc.array(answer, { minLength: 4, maxLength: 4 }),
				fc.boolean(),
				(items, answers, seeded) => {
					const h = make(items, answers);
					if (seeded) h.marks = [seed(at(1, 1))];
					for (const memory of Object.values(memoryOf(h))) {
						const days = (Date.parse(memory.due) - Date.parse(memory.lastAt)) / DAY_MS;
						expect(forgetting_curve(default_w, days, memory.stability)).toBeCloseTo(
							default_request_retention,
							6
						);
					}
				}
			)
		);
	});

	it('counts a check exactly as a lookup', () => {
		fc.assert(
			fc.property(
				fc.array(item, { size: 'max', maxLength: 30 }),
				fc.array(answer, { minLength: 4, maxLength: 4 }),
				(items, answers) => {
					const asLookups = items.map((i) => (i.kind === 'check' ? { ...i, kind: 'lookup' } : i));
					expect(evidenceFor(make(items, answers))).toEqual(evidenceFor(make(asLookups, answers)));
				}
			)
		);
	});
});

describe('a card from knowing (issue #5)', () => {
	// Never tapped, and met untapped in two separate sessions answered "I tapped every word I didn't
	// know" with the line's English not shown: an active card outside the new-word budget.
	const allIn = (...sessions: number[]) =>
		new Map(sessions.map((session) => [session, 'all' as const]));
	const reading = (h: WordHistory) => memoryOf(h).reading;

	it('is known after untapped meetings in two such sessions', () => {
		const h = history({ exposures: [seen(1, at(3)), seen(2, at(5))], answers: allIn(1, 2) });
		expect(reading(h)?.known).toBe(true);
		expect(reading(h)?.card).toBe(false);
	});

	it('is not known from one session, under shown English, or in an unanswered session', () => {
		const once = history({ exposures: [seen(1, at(3)), seen(1, at(5))], answers: allIn(1) });
		const helped = history({
			exposures: [seen(1, at(3)), seen(2, at(5), false, true, true)],
			answers: allIn(1, 2)
		});
		const unanswered = history({ exposures: [seen(1, at(3)), seen(2, at(5))], answers: allIn(1) });
		for (const h of [once, helped, unanswered]) expect(reading(h)?.known).toBeFalsy();
	});

	it('is a candidate instead once the word was tapped at any point', () => {
		const h = history({
			events: [lookup(3, at(7))],
			exposures: [seen(1, at(3)), seen(2, at(5))],
			answers: allIn(1, 2, 3)
		});
		expect(reading(h)?.known).toBeFalsy();
		expect(reading(h)?.card).toBe(true);
	});
});
