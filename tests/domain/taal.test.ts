import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	localHourOf,
	recordSent,
	shareOn,
	taalSessions,
	toSend,
	type TaalInputs,
	type TaalSession
} from '../../src/lib/domain/taal';
import { studyDayOf } from '../../src/lib/domain/study';

const hour = localHourOf('Europe/Brussels');
const none: TaalInputs = { studyTime: [], answers: [], cards: [], drills: [] };

/** `minutes` of one-minute study-time events of a session, ending from `from` on. */
function reading(sessionId: number | null, from: string, minutes: number, durationMs = 60000) {
	const start = new Date(from).getTime();
	return Array.from({ length: minutes }, (_, i) => ({
		at: new Date(start + (i + 1) * 60000).toISOString(),
		durationMs,
		sessionId
	}));
}

const sessionsOf = (inputs: Partial<TaalInputs>) => taalSessions({ ...none, ...inputs }, hour);
const ms = (iso: string) => Date.parse(iso);

describe('taalSessions (spec 020 mapping, one session per local hour)', () => {
	it('counts an unanswered session as Input, from its first moment in the hour', () => {
		expect(sessionsOf({ studyTime: reading(1, '2026-10-26T10:00:00Z', 12) })).toEqual([
			{ id: '2026-10-26T11', at: ms('2026-10-26T10:01:00Z'), input: 12 }
		]);
	});

	it('counts a session answered "every unknown word" as Study, other answers as Input', () => {
		const studyTime = [
			...reading(1, '2026-10-26T10:00:00Z', 5),
			...reading(2, '2026-10-26T10:10:00Z', 3),
			...reading(3, '2026-10-26T10:20:00Z', 2),
			...reading(4, '2026-10-26T10:30:00Z', 1)
		];
		const answers = [
			{ sessionId: 1, answer: 'all' as const },
			{ sessionId: 2, answer: 'some' as const },
			{ sessionId: 3, answer: 'none' as const },
			{ sessionId: 4, answer: null }
		];
		expect(sessionsOf({ studyTime, answers })).toEqual([
			{ id: '2026-10-26T11', at: ms('2026-10-26T10:01:00Z'), input: 6, study: 5 }
		]);
	});

	it('counts study time without a session as Input', () => {
		expect(sessionsOf({ studyTime: reading(null, '2026-10-26T10:00:00Z', 2) })).toEqual([
			{ id: '2026-10-26T11', at: ms('2026-10-26T10:01:00Z'), input: 2 }
		]);
	});

	it('caps each study-time event at a minute, as the week on Progress does', () => {
		expect(
			sessionsOf({ studyTime: [{ at: '2026-10-26T10:00:00Z', durationMs: 600000, sessionId: 1 }] })
		).toEqual([{ id: '2026-10-26T11', at: ms('2026-10-26T10:00:00Z'), input: 1 }]);
	});

	it('counts Cards reviews as cards', () => {
		const cards = Array.from({ length: 25 }, (_, i) => ({
			at: new Date(ms('2026-10-26T09:00:00Z') + i * 10000).toISOString()
		}));
		expect(sessionsOf({ cards })).toEqual([
			{ id: '2026-10-26T10', at: ms('2026-10-26T09:00:00Z'), cards: 25 }
		]);
	});

	it('counts a drill part from its start to its end as Study, idle time included', () => {
		expect(
			sessionsOf({
				drills: [{ start: '2026-10-26T10:00:00Z', end: '2026-10-26T10:14:00Z', lastGrade: null }]
			})
		).toEqual([{ id: '2026-10-26T11', at: ms('2026-10-26T10:00:00Z'), study: 14 }]);
	});

	it('counts a drill part without an end up to its last grade, and one with neither not at all', () => {
		expect(
			sessionsOf({
				drills: [
					{ start: '2026-10-26T10:00:00Z', end: null, lastGrade: '2026-10-26T10:07:00Z' },
					{ start: '2026-10-26T11:00:00Z', end: null, lastGrade: null }
				]
			})
		).toEqual([{ id: '2026-10-26T11', at: ms('2026-10-26T10:00:00Z'), study: 7 }]);
	});

	it('splits a drill at the whole local hour, so no session crosses a day end', () => {
		// 03:50–04:20 Brussels (UTC+1 after 25 October); the day ends at 04:00.
		expect(
			sessionsOf({
				drills: [{ start: '2026-10-27T02:50:00Z', end: '2026-10-27T03:20:00Z', lastGrade: null }]
			})
		).toEqual([
			{ id: '2026-10-27T03', at: ms('2026-10-27T02:50:00Z'), study: 10 },
			{ id: '2026-10-27T04', at: ms('2026-10-27T03:00:00Z'), study: 20 }
		]);
	});

	it("starts a session at its hour's first moment, whatever it came from", () => {
		expect(
			sessionsOf({
				cards: [{ at: '2026-10-26T10:30:00Z' }],
				drills: [{ start: '2026-10-26T10:05:00Z', end: '2026-10-26T10:10:00Z', lastGrade: null }]
			})
		).toEqual([{ id: '2026-10-26T11', at: ms('2026-10-26T10:05:00Z'), study: 5, cards: 1 }]);
	});

	it('uses the local hour where the zone is half an hour off UTC', () => {
		// 10:20–10:40 UTC is 15:50–16:10 in Kolkata (UTC+5:30): two local hours.
		expect(
			taalSessions(
				{
					...none,
					drills: [{ start: '2026-10-26T10:20:00Z', end: '2026-10-26T10:40:00Z', lastGrade: null }]
				},
				localHourOf('Asia/Kolkata')
			)
		).toEqual([
			{ id: '2026-10-26T15', at: ms('2026-10-26T10:20:00Z'), study: 10 },
			{ id: '2026-10-26T16', at: ms('2026-10-26T10:30:00Z'), study: 10 }
		]);
	});

	it('gives minutes to a tenth, rounded once per session and mode', () => {
		const studyTime = [1, 2, 3].flatMap((id) => reading(id, `2026-10-26T10:1${id}:00Z`, 1, 40000));
		expect(sessionsOf({ studyTime })).toEqual([
			{ id: '2026-10-26T11', at: ms('2026-10-26T10:12:00Z'), input: 2 }
		]);
		expect(sessionsOf({ studyTime: reading(1, '2026-10-26T10:00:00Z', 1, 40000) })[0].input).toBe(
			0.7
		);
	});
});

describe('shareOn', () => {
	it("sums a study day's sessions to whole minutes, by the reader's day end", () => {
		const day = studyDayOf('Europe/Brussels', 4);
		const sessions: TaalSession[] = [
			{ id: 'a', at: ms('2026-10-27T02:30:00Z'), input: 3 }, // 03:30, still the 26th
			{ id: 'b', at: ms('2026-10-27T08:00:00Z'), input: 0.7, study: 2, cards: 4 },
			{ id: 'c', at: ms('2026-10-27T09:00:00Z'), input: 0.7 }
		];
		expect(shareOn(sessions, day, '2026-10-27')).toEqual({ input: 1, study: 2, cards: 4 });
	});
});

const s = (id: string, fields: Partial<TaalSession> = {}): TaalSession => ({
	id,
	at: ms(`2026-10-26T${id.slice(-2)}:00:00Z`),
	...fields
});
const all = () => true;

describe('toSend', () => {
	it('sends a session that is new or changed, and nothing that Taal already has', () => {
		const sent = { '2026-10-26T10': s('2026-10-26T10', { input: 4 }) };
		const now = [s('2026-10-26T10', { input: 4 }), s('2026-10-26T11', { study: 2 })];
		expect(toSend(now, sent, all)).toEqual([s('2026-10-26T11', { study: 2 })]);
		expect(toSend([s('2026-10-26T10', { input: 5 })], sent, all)).toEqual([
			s('2026-10-26T10', { input: 5 })
		]);
	});

	it('removes at Taal a session that has nothing in it any more, by sending it empty', () => {
		const sent = { '2026-10-26T10': s('2026-10-26T10', { input: 4 }) };
		expect(toSend([], sent, all)).toEqual([s('2026-10-26T10')]);
	});

	it('sends nothing outside the window: before the connect, or older than Taal keeps', () => {
		const inWindow = (session: { at: number }) => session.at >= ms('2026-10-26T11:00:00Z');
		const sent = { '2026-10-26T10': s('2026-10-26T10', { input: 4 }) };
		expect(
			toSend([s('2026-10-26T10', { input: 9 }), s('2026-10-26T12', { input: 1 })], sent, inWindow)
		).toEqual([s('2026-10-26T12', { input: 1 })]);
		expect(toSend([], sent, inWindow)).toEqual([]);
	});

	it('sends oldest first', () => {
		const now = [s('2026-10-26T12', { input: 1 }), s('2026-10-26T09', { input: 1 })];
		expect(toSend(now, {}, all).map((x) => x.id)).toEqual(['2026-10-26T09', '2026-10-26T12']);
	});
});

it("leaves Taal holding exactly this app's current sessions after any sequence of sends (SC-002)", () => {
	const ids = ['2026-10-26T09', '2026-10-26T10', '2026-10-26T11', '2026-10-26T12'];
	const amount = fc.option(
		fc.integer({ min: 1, max: 600 }).map((n) => n / 10),
		{ nil: undefined }
	);
	const step = fc.oneof(
		fc.record({
			kind: fc.constant('share' as const),
			id: fc.constantFrom(...ids),
			input: amount,
			study: amount,
			cards: fc.option(fc.integer({ min: 1, max: 99 }), { nil: undefined })
		}),
		fc.record({ kind: fc.constant('clear' as const), id: fc.constantFrom(...ids) }),
		fc.record({ kind: fc.constant('send' as const), lands: fc.boolean() })
	);
	fc.assert(
		fc.property(fc.array(step, { size: 'max', maxLength: 60 }), (steps) => {
			const current = new Map<string, TaalSession>();
			const taal = new Map<string, TaalSession>();
			let sent: Record<string, TaalSession> = {};
			const send = (lands: boolean) => {
				const batch = toSend([...current.values()], sent, all);
				if (!lands) return batch;
				// Taal's contract: an id replaces that session; one with no amounts is removed.
				for (const session of batch) {
					const { id } = session;
					if (Object.keys(session).length > 2) taal.set(id, session);
					else taal.delete(id);
				}
				sent = recordSent(sent, batch);
				return batch;
			};
			for (const st of steps) {
				if (st.kind === 'clear') current.delete(st.id);
				else if (st.kind === 'share') {
					const session = s(st.id);
					for (const mode of ['input', 'study', 'cards'] as const)
						if (st[mode] !== undefined) session[mode] = st[mode];
					if (Object.keys(session).length > 2) current.set(st.id, session);
					else current.delete(st.id);
				} else if (send(st.lands) && st.lands) {
					expect(Object.fromEntries(taal)).toEqual(Object.fromEntries(current));
					expect(send(true)).toEqual([]);
				}
			}
		})
	);
});
