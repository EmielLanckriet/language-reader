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

it('counts activity before the chosen hour toward the day before, by the local clock', () => {
	const at = (iso: string) => ({ kind: 'study-time', at: iso, detail: { durationMs: 60000 } });
	const done = (events: ReturnType<typeof at>[], now: string, hour: number) =>
		studyWeek(events, 'Europe/Brussels', new Date(now), hour)
			.days.filter((d) => d.done)
			.map((d) => d.date);
	// 03:30 and 04:30 Brussels summer time on Wednesday 30 September.
	const night = [at('2026-09-30T01:30:00Z')];
	expect(done(night, '2026-09-30T12:00:00Z', 4)).toEqual(['2026-09-29']);
	expect(done(night, '2026-09-30T12:00:00Z', 0)).toEqual(['2026-09-30']);
	expect(done([at('2026-09-30T02:30:00Z')], '2026-09-30T12:00:00Z', 4)).toEqual(['2026-09-30']);
	// The night clocks go forward, 04:30 local is 02:30Z: a fixed four-hour shift would say Saturday.
	expect(done([at('2027-03-28T02:30:00Z')], '2027-03-28T12:00:00Z', 4)).toEqual(['2027-03-28']);
	// At 03:00 on a Monday, with the day ending at 4, it is still Sunday of the week before.
	const monday = studyWeek([], 'Europe/Brussels', new Date('2026-10-05T01:00:00Z'), 4);
	expect(monday.today).toBe('2026-10-04');
	expect(monday.days[0].date).toBe('2026-09-28');
});
