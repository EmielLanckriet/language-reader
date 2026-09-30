import { expect, it } from 'vitest';
import fc from 'fast-check';
import { studyWeek } from '../../src/lib/domain/study';
import { validateEncounter } from '../../src/lib/domain/encounter';

it('awards each local day once, independent of grades and feedback', () => {
	fc.assert(
		fc.property(
			fc.array(fc.integer({ min: 1, max: 4 }), { minLength: 5, maxLength: 30 }),
			(grades) => {
				const events = grades.map((grade) => ({
					kind: 'review',
					at: '2026-09-29T23:30:00Z',
					detail: { grade }
				}));
				const week = studyWeek(events, 'Europe/Brussels', new Date('2026-09-30T12:00:00Z'));
				expect(week.days.filter((d) => d.done).map((d) => d.date)).toEqual(['2026-09-30']);
				expect(
					studyWeek(
						[...events, { kind: 'attention', at: events[0].at, detail: { answer: 'all' } }],
						'Europe/Brussels',
						new Date('2026-09-30T12:00:00Z')
					)
				).toEqual(week);
			}
		)
	);
});

it('uses Monday weeks across DST and keeps incomplete activity visible', () => {
	const week = studyWeek(
		[
			{ kind: 'study-time', at: '2026-10-25T01:30:00Z', detail: { durationMs: 30000 } },
			{ kind: 'study-time', at: '2026-10-25T02:30:00Z', detail: { durationMs: 30000 } },
			{ kind: 'review', at: '2026-10-24T12:00:00Z', detail: { grade: 1 } },
			{ kind: 'review', at: '2026-10-18T12:00:00Z', detail: { grade: 3 } }
		],
		'Europe/Brussels',
		new Date('2026-10-25T12:00:00Z')
	);
	expect(week.days.map((d) => d.date)).toEqual([
		'2026-10-19',
		'2026-10-20',
		'2026-10-21',
		'2026-10-22',
		'2026-10-23',
		'2026-10-24',
		'2026-10-25'
	]);
	expect(week.completed).toBe(1);
	expect(week.days[5]).toMatchObject({ reviews: 1, done: false });
	expect(week.days[6]).toMatchObject({ durationMs: 60000, done: true });
});

it('refuses impossible activity chunks before persistence', () => {
	for (const durationMs of [-1, 0, NaN, Infinity, 60001, '1000']) {
		expect(() =>
			validateEncounter({ kind: 'study-time', at: '2026-09-30T10:00:00Z', detail: { durationMs } })
		).toThrow();
	}
	expect(() =>
		validateEncounter({
			kind: 'study-time',
			at: '2026-09-30T10:00:00Z',
			detail: { durationMs: 5000 }
		})
	).not.toThrow();
});
