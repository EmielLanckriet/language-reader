import type { AttentionAnswer, Engagement } from './encounter';

export interface StudyEvent {
	kind: string;
	at: string;
	detail: Record<string, unknown>;
}
export interface StudySession {
	id: number;
	documentId: number;
	title: string;
	modality: string;
	startedAt: string;
	lastAt: string;
	activityMs: number;
	ended: boolean;
	answered: boolean;
	answer: AttentionAnswer;
	/** How the reader says they took it in, when they said; the latest saying wins. */
	engagement: Engagement | null;
	available: boolean;
}

/**
 * How much reading or playing a session needs before it asks for feedback, on leaving or on
 * finishing (issue #32, the reader: a mere visit does not deserve a grade).
 */
export const FEEDBACK_AFTER_MS = 10_000;

export function studyWeek(
	events: StudyEvent[],
	timeZone: string,
	now = new Date(),
	dayEndHour = 0
) {
	const { today, monday, activity } = studyDays(events, timeZone, now, dayEndHour);
	const days = Array.from({ length: 7 }, (_, i) => {
		const date = shift(monday, i);
		const day = activity.get(date) ?? { durationMs: 0, reviews: 0 };
		return {
			date,
			label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
			...day,
			done: isStudyDay(day)
		};
	});
	return { days, today, completed: days.filter((d) => d.done).length, target: 5 };
}

/**
 * Study days since the last Monday–Sunday week that ended under five (#38, asked for 2026-10-12):
 * missed calendar days cost nothing, and the running week never breaks it.
 */
export function studyStreak(
	events: StudyEvent[],
	timeZone: string,
	now = new Date(),
	dayEndHour = 0
): number {
	const { monday, activity } = studyDays(events, timeZone, now, dayEndHour);
	const doneIn = (start: string) =>
		Array.from({ length: 7 }, (_, i) => activity.get(shift(start, i))).filter(
			(day) => day && isStudyDay(day)
		).length;
	let streak = doneIn(monday);
	for (let start = shift(monday, -7); doneIn(start) >= 5; start = shift(start, -7))
		streak += doneIn(start);
	return streak;
}

const isStudyDay = (day: { durationMs: number; reviews: number }) =>
	day.durationMs >= 60000 || day.reviews >= 5;

function shift(date: string, days: number): string {
	const moved = new Date(`${date}T00:00:00Z`);
	moved.setUTCDate(moved.getUTCDate() + days);
	return moved.toISOString().slice(0, 10);
}

/**
 * Activity per study day up to `now`. Calendar arithmetic uses UTC dates as date labels, not
 * 24-hour jumps through local DST. A day ends at `dayEndHour` on the local clock (asked for
 * 2026-10-04): activity before it belongs to the day before, and a week runs from that hour on
 * Monday.
 */
function studyDays(events: StudyEvent[], timeZone: string, now: Date, dayEndHour: number) {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		hourCycle: 'h23'
	});
	// Every time zone's offset is a whole number of quarter hours, so one label serves a quarter.
	const labels = new Map<number, string>();
	const dateOf = (date: Date) => {
		const quarter = Math.floor(date.getTime() / 900000);
		let label = labels.get(quarter);
		if (label === undefined) labels.set(quarter, (label = labelOf(date)));
		return label;
	};
	const labelOf = (date: Date) => {
		const parts = formatter.formatToParts(date);
		const part = (kind: string) => parts.find((p) => p.type === kind)!.value;
		const label = `${part('year')}-${part('month')}-${part('day')}`;
		return Number(part('hour')) >= dayEndHour ? label : shift(label, -1);
	};
	const today = dateOf(now);
	const monday = shift(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7));
	const activity = new Map<string, { durationMs: number; reviews: number }>();
	for (const event of events) {
		const at = new Date(event.at);
		if (!Number.isFinite(at.getTime()) || at > now) continue;
		const date = dateOf(at);
		const day = activity.get(date) ?? { durationMs: 0, reviews: 0 };
		activity.set(date, day);
		if (event.kind === 'review') day.reviews++;
		if (
			event.kind === 'study-time' &&
			typeof event.detail.durationMs === 'number' &&
			Number.isFinite(event.detail.durationMs)
		)
			day.durationMs += Math.max(0, Math.min(60000, event.detail.durationMs));
	}
	return { today, monday, activity };
}

export interface StudyOverview {
	week: ReturnType<typeof studyWeek>;
	streak: number;
	sessions: StudySession[];
	resume: { documentId: number; title: string; modality: string } | null;
}
