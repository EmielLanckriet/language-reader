import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { nextBatch, upgradeStart, BATCH_BUDGET_MS } from '../../src/lib/storage/upgrade';
import { codePointsOf } from '../../src/lib/domain/offsets';
import { pairwiseAnalyzer as pairwise, unitBoundaries as boundariesOf } from './support';
import type { StoredDocument } from '../../src/lib/storage/repository';

// The driver that turns "upgrade this document" into instalments (ADR-0016).
//
// One property here is the reason the file exists: a real task boundary is taken between units.
// `await` alone yields microtasks, a browser paints between tasks, and the difference is the whole
// of research.md R20.
//
// What this file deliberately does **not** assert is that analysing a stretch on its own gives the
// same answer as analysing the whole document. That is what makes resuming legitimate, but it is a
// property of the analyzers rather than of this driver, and a fake analyzer that decides each unit
// independently — which every fake of this shape does — makes it true whatever the driver does. It
// is checked against the real analyzers in tests/analyzer/unit-locality.test.ts. An audit of these
// tests found it asserted here and passing for that reason, which is worse than not asserting it:
// a test that cannot fail reads as coverage.

const TEXT =
	'我在中国学习中文。他骑自行车去上班。今天天气很好！你是哪国人？' +
	'她昨天买了一本新书。我们一起去看电影吧！明天见。';

function documentOf(text = TEXT): StoredDocument {
	return {
		id: 1,
		rawContent: text,
		contentType: 'text/plain',
		language: 'zh',
		analyzer: 'character-splitter',
		analyzerVersion: '1',
		title: 'test',
		createdAt: '2026-09-04T00:00:00.000Z',
		tokens: []
	};
}

function unitBoundaries(text: string): number[] {
	return boundariesOf(text, pairwise);
}

/** Never waits, so the budget can be driven by a fake clock instead of by real time. */
const immediately = () => Promise.resolve();

describe('planning where an upgrade starts', () => {
	it('resumes its own progress and restarts one left by another analyzer', () => {
		const document = documentOf();

		expect(upgradeStart(document, pairwise)).toEqual({ from: 0, atLeast: 0 });

		const mine = { ...document, upgrade: { analyzer: 'pairwise-test', version: '1', through: 18 } };
		expect(upgradeStart(mine, pairwise)).toEqual({ from: 18, atLeast: 18 });

		// A prefix written by an analyzer no longer in force is not a head start. It has to be
		// covered again, or the tokens beyond the new boundary would be stamped as something that
		// never produced them.
		const theirs = {
			...document,
			upgrade: { analyzer: 'pairwise-test', version: '0', through: 18 }
		};
		expect(upgradeStart(theirs, pairwise)).toEqual({ from: 0, atLeast: 18 });
	});
});

describe('taking the next batch of an upgrade', () => {
	it('stops on a unit boundary, never inside one', async () => {
		const boundaries = new Set(unitBoundaries(TEXT));

		await fc.assert(
			fc.asyncProperty(fc.integer({ min: 0, max: 20000 }), async (budgetMs) => {
				const batch = await nextBatch(
					documentOf(),
					pairwise,
					{ from: 0, atLeast: 0 },
					{ budgetMs, yieldToBrowser: immediately }
				);
				expect(boundaries.has(batch!.through)).toBe(true);
			}),
			{ numRuns: 20 }
		);
	});

	it('lets the browser have a turn between units', async () => {
		// The point of the whole exercise, and the thing an `await` does not do. A timer stands in
		// for the paint that never happened: it is scheduled before the batch and must have run by
		// the time the batch is done. With microtask-only yielding it cannot (scripts/measure/yield.mjs).
		let timerRan = false;
		setTimeout(() => (timerRan = true), 0);

		await nextBatch(documentOf(), pairwise, { from: 0, atLeast: 0 }, { budgetMs: 0 });

		expect(timerRan).toBe(true);
	});

	it('stops when the budget is spent, and not before it must', async () => {
		// A fake clock, so the property is about the rule rather than about how fast this machine is.
		let clock = 0;
		const now = () => (clock += 1000);

		const batch = await nextBatch(
			documentOf(),
			pairwise,
			{ from: 0, atLeast: 0 },
			{ budgetMs: 3000, now, yieldToBrowser: immediately }
		);

		// Started at 1000, so the third unit is the first to be checked at or past 3000 elapsed.
		expect(batch!.through).toBe(unitBoundaries(TEXT)[2]);
	});

	it('never stops short of a superseded upgrade, however small the budget', async () => {
		const boundaries = unitBoundaries(TEXT);
		const atLeast = boundaries[3];

		const batch = await nextBatch(
			documentOf(),
			pairwise,
			{ from: 0, atLeast },
			{ budgetMs: 0, yieldToBrowser: immediately }
		);

		expect(batch!.through).toBeGreaterThanOrEqual(atLeast);
	});

	it('says there is nothing left when the document is finished', async () => {
		const end = codePointsOf(TEXT).length;
		const batch = await nextBatch(
			documentOf(),
			pairwise,
			{ from: end, atLeast: end },
			{ yieldToBrowser: immediately }
		);
		expect(batch).toBeUndefined();
	});

	it('refuses to resume from somewhere no analyzer could have stopped', async () => {
		await expect(
			nextBatch(documentOf(), pairwise, { from: 3, atLeast: 3 }, { yieldToBrowser: immediately })
		).rejects.toThrow(/not a segmentation-unit boundary/);
	});

	it('budgets in time rather than in characters', () => {
		// Stated as an assertion because the alternative is what a reader of this file would assume,
		// and it would be wrong on a slower phone: the same character count is a different amount of
		// work on every device.
		expect(BATCH_BUDGET_MS).toBe(5000);
	});
});
