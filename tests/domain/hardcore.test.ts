import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { Token } from '../../src/lib/domain/types';
import { memoryOf, type WordHistory } from '../../src/lib/domain/memory';
import {
	afterGrade,
	classify,
	cutByLoad,
	drillWords,
	nextStep,
	type Filters,
	type FragmentWord,
	type WordClass
} from '../../src/lib/domain/hardcore';
import type { HardcoreStep } from '../../src/lib/domain/encounter';

// Hardcore mode's session logic (spec 014). Parts and word choices are derived: asserted by
// properties. The in-drill order is a rule of the session: asserted exactly.

describe('the drill queue', () => {
	it('passes the head on Hard, Good or Easy', () => {
		for (const grade of [2, 3, 4]) expect(afterGrade([1, 2, 3], grade)).toEqual([2, 3]);
	});

	it('puts the head back three cards later on Again, or last when fewer remain', () => {
		expect(afterGrade([1, 2, 3, 4, 5], 1)).toEqual([2, 3, 4, 1, 5]);
		expect(afterGrade([1, 2, 3], 1)).toEqual([2, 3, 1]);
		expect(afterGrade([1], 1)).toEqual([1]);
	});

	it('empties only once every word passed, losing and doubling none', () => {
		fc.assert(
			fc.property(
				fc.uniqueArray(fc.integer({ min: 1, max: 1000 }), {
					minLength: 1,
					maxLength: 60,
					size: 'max'
				}),
				fc.array(fc.integer({ min: 1, max: 4 }), { maxLength: 200, size: 'max' }),
				(ids, grades) => {
					let queue = ids;
					const passed = new Set<number>();
					for (const grade of [...grades, ...ids.map(() => 3), ...ids.map(() => 3)]) {
						if (queue.length === 0) break;
						if (grade > 1) passed.add(queue[0]);
						queue = afterGrade(queue, grade);
						expect(new Set(queue).size).toBe(queue.length);
						expect([...queue, ...passed].sort((a, b) => a - b)).toEqual(
							[...ids].sort((a, b) => a - b)
						);
					}
					expect(queue).toEqual([]);
				}
			)
		);
	});
});

describe('the next step', () => {
	const steps: HardcoreStep[] = ['watch-first', 'drill'];
	const end = (part: number, step: HardcoreStep) => ({ part, step, at: 'end' as const });

	it('is the first step of the plan not ended, part by part', () => {
		expect(nextStep(steps, 2, [])).toEqual({ part: 0, step: 'watch-first' });
		expect(nextStep(steps, 2, [end(0, 'watch-first')])).toEqual({ part: 0, step: 'drill' });
		const firstDone = [end(0, 'watch-first'), end(0, 'drill')];
		expect(nextStep(steps, 2, firstDone)).toEqual({ part: 1, step: 'watch-first' });
		expect(
			nextStep(steps, 2, [...firstDone, end(1, 'watch-first'), end(1, 'drill')])
		).toBeUndefined();
	});

	it('starts from the part the reader picked', () => {
		expect(nextStep(steps, 3, [], 2)).toEqual({ part: 2, step: 'watch-first' });
	});

	it('takes a started step for not done', () => {
		const started = { part: 0, step: 'watch-first' as const, at: 'start' as const };
		expect(nextStep(steps, 1, [started])).toEqual({ part: 0, step: 'watch-first' });
	});
});

// A document as lines of tokens: a number is a word's lexeme, 0 a punctuation mark.
const CLASSES: WordClass[] = ['new', 'due', 'excluded'];
const documentArb = fc.record({
	lines: fc.array(fc.array(fc.integer({ min: 0, max: 12 }), { maxLength: 8, size: 'max' }), {
		minLength: 1,
		maxLength: 40,
		size: 'max'
	}),
	classes: fc.array(fc.constantFrom(...CLASSES), { minLength: 13, maxLength: 13 }),
	known: fc.array(fc.boolean(), { minLength: 13, maxLength: 13 }),
	ranks: fc.array(fc.option(fc.integer({ min: 0, max: 5000 })), { minLength: 13, maxLength: 13 })
});

type DocumentShape = typeof documentArb extends fc.Arbitrary<infer T> ? T : never;

function build(doc: DocumentShape) {
	const tokens: Token[] = [];
	const lineRanges: [number, number][] = [];
	let offset = 0;
	for (const line of doc.lines) {
		const start = offset;
		for (const id of line) {
			tokens.push(
				id === 0
					? { start: offset, end: offset + 1, isWord: false }
					: { start: offset, end: offset + 1, isWord: true, lexemeId: id }
			);
			offset += 1;
		}
		lineRanges.push([start, offset]);
		offset += 1; // the newline
	}
	const words = new Map<number, FragmentWord>();
	for (let id = 1; id <= 12; id++)
		words.set(id, {
			lexemeId: id,
			class: doc.classes[id],
			known: doc.known[id],
			...(doc.ranks[id] === null ? {} : { rank: doc.ranks[id]! })
		});
	return { tokens, lineRanges, words };
}

const fragmentOf = (lines: number) =>
	fc.tuple(fc.nat(), fc.nat()).map(([a, b]) => {
		const [x, y] = [a % lines, b % lines].sort((p, q) => p - q);
		return [x, y] as [number, number];
	});

describe('the words of a fragment', () => {
	it('are its drillable words, once each, with the first line they occur on', () => {
		fc.assert(
			fc.property(
				documentArb.chain((doc) => fc.tuple(fc.constant(doc), fragmentOf(doc.lines.length))),
				fc.constantFrom('frequency' as const, 'story' as const),
				([doc, fragment], order) => {
					const { tokens, lineRanges, words } = build(doc);
					const found = drillWords(lineRanges, fragment, tokens, words, { order, filters: {} });
					const inFragment = doc.lines.slice(fragment[0], fragment[1] + 1).flat();
					const drillable = new Set(
						inFragment.filter((id) => id > 0 && words.get(id)!.class !== 'excluded')
					);
					expect(new Set(found.map((w) => w.lexemeId))).toEqual(drillable);
					expect(found.length).toBe(drillable.size);
					for (const { lexemeId, line } of found)
						expect(line).toBe(
							fragment[0] + doc.lines.slice(fragment[0]).findIndex((l) => l.includes(lexemeId))
						);
				}
			)
		);
	});

	it('come most frequent first, or in story order', () => {
		fc.assert(
			fc.property(
				documentArb.chain((doc) => fc.tuple(fc.constant(doc), fragmentOf(doc.lines.length))),
				([doc, fragment]) => {
					const { tokens, lineRanges, words } = build(doc);
					const inFragment = doc.lines.slice(fragment[0], fragment[1] + 1).flat();
					const count = (id: number) => inFragment.filter((x) => x === id).length;
					const first = (id: number) => inFragment.indexOf(id);
					const byFrequency = drillWords(lineRanges, fragment, tokens, words, {
						order: 'frequency',
						filters: {}
					}).map((w) => w.lexemeId);
					for (let i = 1; i < byFrequency.length; i++) {
						const [a, b] = [byFrequency[i - 1], byFrequency[i]];
						expect(count(a) > count(b) || (count(a) === count(b) && first(a) < first(b))).toBe(
							true
						);
					}
					const story = drillWords(lineRanges, fragment, tokens, words, {
						order: 'story',
						filters: {}
					}).map((w) => w.lexemeId);
					for (let i = 1; i < story.length; i++)
						expect(first(story[i - 1])).toBeLessThan(first(story[i]));
				}
			)
		);
	});
});

describe('which words a drill takes (FR-004)', () => {
	const now = new Date('2026-12-01T10:00:00Z');
	const at = (day: number) => new Date(Date.UTC(2026, 9, day, 10)).toISOString();
	let seq = 0;
	const o = (when: string) => ({ deviceId: 'd', deviceSeq: ++seq, at: when });
	const review = (when: string) => ({
		...o(when),
		kind: 'review',
		detail: { skill: 'reading', grade: 3 }
	});
	const lookup = (when: string) => ({
		...o(when),
		kind: 'lookup',
		sessionId: 1,
		modality: 'reading' as const,
		detail: {}
	});
	const reading = (h: Partial<WordHistory>) =>
		memoryOf({ marks: [], events: [], exposures: [], answers: new Map(), ...h }).reading;
	it('classes each word by its memory alone, active or retired (spec 019)', () => {
		expect(classify(undefined, undefined, now).class).toBe('new');
		// Tapped in October, never a card: due by December.
		expect(classify(undefined, reading({ events: [lookup(at(1))] }), now).class).toBe('due');
		// Reviewed on Cards in October: due by December.
		expect(classify(undefined, reading({ events: [review(at(1))] }), now).class).toBe('due');
		// Reviewed the day before: not due.
		const recent = reading({ events: [review('2026-11-30T10:00:00Z')] });
		expect(classify(undefined, recent, now).class).toBe('excluded');
		// Issue #46: never a card, passed in a drill an hour before: not due, so not drilled again.
		const drilled = reading({
			events: [
				lookup(at(1)),
				{
					...review('2026-12-01T09:00:00Z'),
					detail: { skill: 'reading', grade: 3, hardcore: { part: 0 } }
				}
			]
		});
		expect(classify(undefined, drilled, now).class).toBe('excluded');
		// Retired: retiring only keeps a word off Cards, so its memory decides.
		const tapped = reading({ events: [lookup(at(1))] });
		expect(classify('retired', tapped, now).class).toBe('due');
		expect(classify('active', tapped, now).class).toBe('due');
		expect(classify('retired', recent, now).class).toBe('excluded');
		expect(classify('retired', undefined, now).class).toBe('new');
		// An Anki word, judged by its imported memory like any reviewed card.
		const anki = (stability: number) =>
			reading({
				marks: [
					{
						...o(at(1)),
						asserted: 'anki-long-term',
						provenance: `anki ${at(1)} s=${stability} d=5 r=2026-08-18T14:55:21Z decay=0.264`
					}
				]
			});
		expect(classify('retired', anki(1310.8), now).class).toBe('excluded');
		expect(classify('retired', anki(2), now).class).toBe('due');
	});

	it('never drills an ignored word, new or due (spec 019)', () => {
		expect(classify('ignored', undefined, now).class).toBe('excluded');
		expect(classify('ignored', reading({ events: [lookup(at(1))] }), now).class).toBe('excluded');
	});
});

describe('cutting a fragment by load', () => {
	const cutArb = fc
		.record({
			first: fc.nat({ max: 5 }),
			length: fc.integer({ min: 1, max: 60 }),
			n: fc.integer({ min: 1, max: 30 }),
			// How many words each line brings first: mostly few, some lines many.
			perLine: fc.array(fc.oneof(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 50 })), {
				minLength: 60,
				maxLength: 60
			})
		})
		.map(({ first, length, n, perLine }) => {
			const words = [];
			let id = 1;
			for (let line = first; line < first + length; line++)
				for (let k = 0; k < perLine[line - first]; k++) words.push({ lexemeId: id++, line });
			return { fragment: [first, first + length - 1] as [number, number], n, words };
		});

	it('tiles the fragment with parts of about n words, each word in the part holding its line', () => {
		fc.assert(
			fc.property(cutArb, ({ fragment, n, words }) => {
				const parts = cutByLoad(fragment, words, n);
				expect(parts[0].lines[0]).toBe(fragment[0]);
				expect(parts.at(-1)!.lines[1]).toBe(fragment[1]);
				for (let i = 0; i < parts.length; i++) {
					expect(parts[i].lines[0]).toBeLessThanOrEqual(parts[i].lines[1]);
					if (i > 0) expect(parts[i].lines[0]).toBe(parts[i - 1].lines[1] + 1);
				}
				expect(parts.flatMap((p) => p.words)).toEqual(words.map((w) => w.lexemeId));
				for (const part of parts)
					for (const id of part.words) {
						const line = words.find((w) => w.lexemeId === id)!.line;
						expect(line).toBeGreaterThanOrEqual(part.lines[0]);
						expect(line).toBeLessThanOrEqual(part.lines[1]);
					}
				parts.forEach((part, i) => {
					if (i < parts.length - 1) expect(part.words.length).toBeGreaterThanOrEqual(n / 2);
					if (part.words.length > 1.5 * n) {
						const lastLine = words.filter((w) => w.line === part.lines[1]).length;
						expect(lastLine).toBeGreaterThan(n);
					}
				});
			})
		);
	});

	it('joins a short last part to the one before when they fit together', () => {
		const words = Array.from({ length: 12 }, (_, i) => ({ lexemeId: i + 1, line: i < 10 ? 0 : 1 }));
		expect(cutByLoad([0, 1], words, 10)).toEqual([
			{ lines: [0, 1], words: words.map((w) => w.lexemeId) }
		]);
	});

	it('keeps a short fragment in one part', () => {
		const words = [1, 2, 3].map((lexemeId) => ({ lexemeId, line: 4 }));
		expect(cutByLoad([2, 9], words, 20)).toEqual([{ lines: [2, 9], words: [1, 2, 3] }]);
	});
});

describe('filtering the words (FR-005)', () => {
	const filtered = (doc: DocumentShape, fragment: [number, number], filters: Filters) => {
		const { tokens, lineRanges, words } = build(doc);
		return new Set(
			drillWords(lineRanges, fragment, tokens, words, { order: 'frequency', filters }).map(
				(w) => w.lexemeId
			)
		);
	};
	const subset = (a: Set<number>, b: Set<number>) => [...a].every((x) => b.has(x));
	const withFragment = documentArb.chain((doc) =>
		fc.tuple(fc.constant(doc), fragmentOf(doc.lines.length))
	);

	it('only ever removes words, and more so the stricter it is', () => {
		fc.assert(
			fc.property(
				withFragment,
				fc.integer({ min: 1, max: 6 }),
				fc.integer({ min: 0, max: 5000 }),
				fc.double({ min: 0, max: 1, noNaN: true }),
				([doc, fragment], x, y, z) => {
					const all = filtered(doc, fragment, {});
					for (const filters of [{ minOccurrences: x }, { topRank: y }, { coverage: z }])
						expect(subset(filtered(doc, fragment, filters), all)).toBe(true);
					const at = (f: Filters) => filtered(doc, fragment, f);
					expect(subset(at({ minOccurrences: x + 1 }), at({ minOccurrences: x }))).toBe(true);
					expect(subset(at({ topRank: y }), at({ topRank: y + 100 }))).toBe(true);
					expect(subset(at({ coverage: z / 2 }), at({ coverage: z }))).toBe(true);
				}
			)
		);
	});

	it('keeps exactly the occurrence and rank conditions', () => {
		fc.assert(
			fc.property(
				withFragment,
				fc.integer({ min: 1, max: 6 }),
				fc.integer({ min: 0, max: 5000 }),
				([doc, fragment], x, y) => {
					const { words } = build(doc);
					const inFragment = doc.lines.slice(fragment[0], fragment[1] + 1).flat();
					const count = (id: number) => inFragment.filter((v) => v === id).length;
					const all = filtered(doc, fragment, {});
					expect(filtered(doc, fragment, { minOccurrences: x })).toEqual(
						new Set([...all].filter((id) => count(id) >= x))
					);
					expect(filtered(doc, fragment, { topRank: y })).toEqual(
						new Set([...all].filter((id) => (words.get(id)!.rank ?? Infinity) < y))
					);
				}
			)
		);
	});

	it('keeps the fewest unknown words, most frequent first, that reach the coverage', () => {
		fc.assert(
			fc.property(
				withFragment,
				fc.double({ min: 0, max: 1, noNaN: true }),
				([doc, fragment], z) => {
					const { words } = build(doc);
					const inFragment = doc.lines
						.slice(fragment[0], fragment[1] + 1)
						.flat()
						.filter((v) => v > 0);
					const count = (id: number) => inFragment.filter((v) => v === id).length;
					const first = (id: number) => inFragment.indexOf(id);
					// In the code's own form (known ≥ z · total), so rounding cannot set them apart.
					const covered = (kept: Set<number>) =>
						inFragment.filter((id) => words.get(id)!.known || kept.has(id)).length;
					const target = z * inFragment.length;
					const candidates = [...filtered(doc, fragment, {})]
						.filter((id) => !words.get(id)!.known)
						.sort((a, b) => count(b) - count(a) || first(a) - first(b));
					const kept = filtered(doc, fragment, { coverage: z });
					// A prefix of the unknown candidates, by frequency.
					expect([...kept].sort((a, b) => count(b) - count(a) || first(a) - first(b))).toEqual(
						candidates.slice(0, kept.size)
					);
					// Enough, unless every candidate is kept; and one fewer would not be.
					if (kept.size < candidates.length) expect(covered(kept)).toBeGreaterThanOrEqual(target);
					if (kept.size > 0) {
						const fewer = new Set(candidates.slice(0, kept.size - 1));
						expect(covered(fewer)).toBeLessThan(target);
					}
				}
			)
		);
	});
});

describe('the filters at their limits', () => {
	// One line: 一 (known), 二, 二, 三 — four running words, one of them known.
	const tokens: Token[] = [1, 2, 2, 3].map((lexemeId, i) => ({
		start: i,
		end: i + 1,
		isWord: true,
		lexemeId
	}));
	const words = new Map<number, FragmentWord>([
		[1, { lexemeId: 1, class: 'due', known: true, rank: 10 }],
		[2, { lexemeId: 2, class: 'new', known: false, rank: 2000 }],
		[3, { lexemeId: 3, class: 'new', known: false, rank: 1999 }]
	]);
	const kept = (filters: Filters) =>
		drillWords([[0, 4]], [0, 0], tokens, words, { order: 'story', filters }).map((w) => w.lexemeId);

	it('takes the most common y words as ranks below y', () => {
		expect(kept({ topRank: 2000 })).toEqual([1, 3]);
	});

	it('stops at the coverage reached exactly', () => {
		// 一 known is 25 %; 二 brings it to 75 %.
		expect(kept({ coverage: 0.25 })).toEqual([]);
		expect(kept({ coverage: 0.75 })).toEqual([2]);
		expect(kept({ coverage: 0.76 })).toEqual([2, 3]);
	});
});
