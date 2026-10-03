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

/** Calendar arithmetic uses UTC dates as date labels, not 24-hour jumps through local DST. */
export function studyWeek(events: StudyEvent[], timeZone: string, now = new Date()) {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	});
	const dateOf = (date: Date) => {
		const parts = formatter.formatToParts(date);
		return ['year', 'month', 'day']
			.map((kind) => parts.find((p) => p.type === kind)!.value)
			.join('-');
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
