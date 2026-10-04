import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	reviewPredictions,
	type WordHistory,
	type RuleStrengths
} from '../../src/lib/domain/memory';
import { prepare, replay } from '../../src/lib/domain/replay';
import type { FsrsParameters } from '../../src/lib/domain/anki';

// The fit replays a word's evidence with its own FSRS-6 (fsrs6.ts), thousands of times. It is only
// worth anything if it predicts exactly what Reader's memory does (spec 013, T023).

const anki: FsrsParameters = {
	preset: 'anki',
	retention: 0.9,
	weights: [
		0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
		0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542
	]
};

/** What an arbitrary generates. */
type ValueOf<A> = A extends fc.Arbitrary<infer T> ? T : never;

const step = fc.record({
	hours: fc.integer({ min: 0, max: 24 * 40 }),
	kind: fc.constantFrom('review', 'lookup', 'seen', 'seen'),
	grade: fc.constantFrom(1, 2, 3, 4),
	media: fc.boolean(),
	textVisible: fc.boolean(),
	helped: fc.boolean(),
	answer: fc.constantFrom('all', 'all', 'some', null)
});

const seed = fc.record({
	stability: fc.double({ min: 0.5, max: 400, noNaN: true }),
	difficulty: fc.double({ min: 1, max: 10, noNaN: true }),
	dated: fc.boolean()
});

function historyOf(steps: ValueOf<typeof step>[], imported?: ValueOf<typeof seed>): WordHistory {
	const h: WordHistory = { marks: [], events: [], exposures: [], answers: new Map() };
	if (imported) {
		// As an Anki import records it; without `r` the import's own date stands in (undated).
		const r = imported.dated ? ' r=2025-12-20T10:00:00Z' : '';
		h.marks.push({
			at: '2025-12-31T10:00:00Z',
			deviceId: 'd',
			deviceSeq: 0,
			asserted: 'anki-mature',
			provenance: `anki 2025-12-31T10:00:00Z s=${imported.stability} d=${imported.difficulty}${r}`
		});
	}
	let time = Date.UTC(2026, 0, 1, 9);
	steps.forEach((s, i) => {
		time += s.hours * 3_600_000;
		const ordered = { at: new Date(time).toISOString(), deviceId: 'd', deviceSeq: i + 1 };
		const modality = s.media ? ('media' as const) : ('reading' as const);
		const textVisible = s.media ? s.textVisible : undefined;
		if (s.kind === 'review')
			h.events.push({ ...ordered, kind: 'review', detail: { skill: 'reading', grade: s.grade } });
		else if (s.kind === 'lookup')
			h.events.push({
				...ordered,
				kind: 'lookup',
				sessionId: i,
				modality,
				textVisible,
				detail: {}
			});
		else {
			h.exposures.push({ ...ordered, sessionId: i, modality, textVisible, helped: s.helped });
			h.answers.set(i, s.answer);
		}
	});
	return h;
}

const strengths = fc.record({
	seenReading: fc.double({ min: 0, max: 2, noNaN: true }),
	seenListening: fc.double({ min: 0, max: 2, noNaN: true }),
	tapStability: fc.double({ min: 0.2, max: 5, noNaN: true })
});

describe('the fit replay', () => {
	it('predicts every scored observation exactly as Reader does, for any rule strengths', () => {
		fc.assert(
			fc.property(
				fc.array(step, { size: 'max', maxLength: 25 }),
				fc.option(strengths, { nil: undefined }),
				fc.option(seed, { nil: undefined }),
				(steps, rule: RuleStrengths | undefined, imported) => {
					const h = historyOf(steps, imported);
					const theirs = reviewPredictions(h, anki, rule);
					const mine: { probability: number | null; excluded?: string; type: string }[] = [];
					replay(prepare(h), anki.weights, rule, (o) => mine.push(o));
					expect(mine.map((o) => [o.type, o.excluded])).toEqual(
						theirs.map((o) => [o.type, o.excluded])
					);
					mine.forEach((o, i) => {
						if (o.probability === null) expect(theirs[i].probability).toBeNull();
						else expect(Math.abs(o.probability - theirs[i].probability!)).toBeLessThan(1e-6);
					});
				}
			)
		);
	});
});
