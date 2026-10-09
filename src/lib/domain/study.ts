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
 * Progress (issue #32, the reader: a mere visit does not deserve a grade).
 */
export const FEEDBACK_AFTER_MS = 10_000;

/**
 * Calendar arithmetic uses UTC dates as date labels, not 24-hour jumps through local DST. A day
 * ends at `dayEndHour` on the local clock (asked for 2026-10-04): activity before it belongs to
 * the day before, and a week runs from that hour on Monday.
 */
export function studyWeek(
	events: StudyEvent[],
	timeZone: string,
	now = new Date(),
	dayEndHour = 0
) {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		hourCycle: 'h23'
	});
	const dateOf = (date: Date) => {
		const parts = formatter.formatToParts(date);
		const part = (kind: string) => parts.find((p) => p.type === kind)!.value;
		const label = `${part('year')}-${part('month')}-${part('day')}`;
		if (Number(part('hour')) >= dayEndHour) return label;
		const before = new Date(`${label}T00:00:00Z`);
		before.setUTCDate(before.getUTCDate() - 1);
		return before.toISOString().slice(0, 10);
	};
	const today = dateOf(now);
	const monday = new Date(`${today}T00:00:00Z`);
	monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
	const days = Array.from({ length: 7 }, (_, i) => {
		const date = new Date(monday);
		date.setUTCDate(date.getUTCDate() + i);
		return {
			date: date.toISOString().slice(0, 10),
			label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][i],
			durationMs: 0,
			reviews: 0,
			done: false
		};
	});
	for (const event of events) {
		const at = new Date(event.at);
		if (!Number.isFinite(at.getTime()) || at > now) continue;
		const day = days.find((d) => d.date === dateOf(at));
		if (!day) continue;
		if (event.kind === 'review') day.reviews++;
		if (
			event.kind === 'study-time' &&
			typeof event.detail.durationMs === 'number' &&
			Number.isFinite(event.detail.durationMs)
		)
			day.durationMs += Math.max(0, Math.min(60000, event.detail.durationMs));
	}
	for (const day of days) day.done = day.durationMs >= 60000 || day.reviews >= 5;
	return { days, today, completed: days.filter((d) => d.done).length, target: 5 };
}

export interface StudyOverview {
	week: ReturnType<typeof studyWeek>;
	sessions: StudySession[];
	resume: { documentId: number; title: string; modality: string } | null;
}
