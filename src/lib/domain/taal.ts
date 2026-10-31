import type { AttentionAnswer } from './encounter';

/**
 * This app's share of the reader's Taal challenge (spec 020, ADR-0045), as the sessions Taal's
 * connect contract takes: one per local hour, holding Input and Study minutes and Cards reviews by
 * the reader's mapping of 2026-10-26. An hour never crosses a day end, so Taal puts each session
 * on the right day by its own settings. A session's id is its hour, so sending it again replaces
 * it at Taal: totals, never increments.
 */
export const TAAL_MODES = ['input', 'study', 'cards'] as const;
export type TaalMode = (typeof TAAL_MODES)[number];

export interface TaalSession {
	/** The local hour, `YYYY-MM-DDTHH`. */
	id: string;
	/** Its first moment, epoch ms. */
	at: number;
	input?: number;
	study?: number;
	cards?: number;
}

export interface TaalInputs {
	/** Reading and watching, as the week on Progress counts it. */
	studyTime: { at: string; durationMs: number; sessionId: number | null }[];
	/** Each session's latest answer to "Did you look up every word you didn't understand?". */
	answers: { sessionId: number; answer: AttentionAnswer }[];
	/** Reviews on Cards; drill grades are not among them. */
	cards: { at: string }[];
	/** Each hardcore part's drill step: its start and end marks, and its last grade. */
	drills: { start: string; end: string | null; lastGrade: string | null }[];
}

/** Taal clears sessions older than 120 days. */
export const TAAL_KEEPS_DAYS = 120;
/** Taal's limit per request. */
export const TAAL_BATCH = 100;

const QUARTER_MS = 900000;

/**
 * The local hour of a moment in `timeZone`. Every zone's offset is a whole number of quarter
 * hours, so one label serves a UTC quarter.
 */
export function localHourOf(timeZone: string): (date: Date) => string {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		hourCycle: 'h23'
	});
	const labels = new Map<number, string>();
	return (date: Date) => {
		const quarter = Math.floor(date.getTime() / QUARTER_MS);
		let label = labels.get(quarter);
		if (label === undefined) {
			const parts = formatter.formatToParts(date);
			const part = (kind: string) => parts.find((p) => p.type === kind)!.value;
			label = `${part('year')}-${part('month')}-${part('day')}T${part('hour')}`;
			labels.set(quarter, label);
		}
		return label;
	};
}

/** Minutes to a tenth, as Taal's own tracker sends them. */
const tenths = (ms: number) => Math.round(ms / 6000) / 10;

export function taalSessions(inputs: TaalInputs, hourOf: (date: Date) => string): TaalSession[] {
	const hours = new Map<string, { at: number; input: number; study: number; cards: number }>();
	const add = (t: number, mode: TaalMode, amount: number) => {
		const id = hourOf(new Date(t));
		let found = hours.get(id);
		if (!found) hours.set(id, (found = { at: t, input: 0, study: 0, cards: 0 }));
		found.at = Math.min(found.at, t);
		found[mode] += amount;
	};
	const thorough = new Set(
		inputs.answers.filter((a) => a.answer === 'all').map((a) => a.sessionId)
	);
	for (const event of inputs.studyTime) {
		const t = Date.parse(event.at);
		if (!Number.isFinite(t) || !Number.isFinite(event.durationMs)) continue;
		const duration = Math.max(0, Math.min(60000, event.durationMs));
		const mode = event.sessionId !== null && thorough.has(event.sessionId) ? 'study' : 'input';
		add(t, mode, duration);
	}
	for (const review of inputs.cards) {
		const t = Date.parse(review.at);
		if (Number.isFinite(t)) add(t, 'cards', 1);
	}
	for (const drill of inputs.drills) {
		const from = Date.parse(drill.start);
		const to = Date.parse(drill.end ?? drill.lastGrade ?? drill.start);
		for (let t = from; t < to;) {
			const next = Math.min(to, (Math.floor(t / QUARTER_MS) + 1) * QUARTER_MS);
			add(t, 'study', next - t);
			t = next;
		}
	}
	const sessions: TaalSession[] = [];
	for (const [id, hour] of hours) {
		const session: TaalSession = { id, at: hour.at };
		if (tenths(hour.input) > 0) session.input = tenths(hour.input);
		if (tenths(hour.study) > 0) session.study = tenths(hour.study);
		if (hour.cards > 0) session.cards = hour.cards;
		if (Object.keys(session).length > 2) sessions.push(session);
	}
	return sessions.sort((a, b) => a.at - b.at);
}

/** A study day's share in whole minutes and cards, for Progress. */
export function shareOn(
	sessions: TaalSession[],
	dayOf: (date: Date) => string,
	day: string
): { input: number; study: number; cards: number } {
	const sum = { input: 0, study: 0, cards: 0 };
	for (const session of sessions)
		if (dayOf(new Date(session.at)) === day)
			for (const mode of TAAL_MODES) sum[mode] += session[mode] ?? 0;
	return { input: Math.round(sum.input), study: Math.round(sum.study), cards: sum.cards };
}

const same = (a: TaalSession | undefined, b: TaalSession) =>
	a !== undefined && a.at === b.at && TAAL_MODES.every((mode) => a[mode] === b[mode]);

/**
 * What Taal does not have yet, oldest first: sessions that are new or changed since `sent`, and
 * an empty session for each one sent before that has nothing in it now, which Taal removes. Only
 * sessions `inWindow` (from the connect day, FR-011, and still kept by Taal) are sent.
 */
export function toSend(
	current: TaalSession[],
	sent: Record<string, TaalSession>,
	inWindow: (session: { at: number }) => boolean
): TaalSession[] {
	const ids = new Set(current.map((session) => session.id));
	const found = current.filter((session) => inWindow(session) && !same(sent[session.id], session));
	for (const [id, before] of Object.entries(sent))
		if (!ids.has(id) && inWindow(before)) found.push({ id, at: before.at });
	return found.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
}

/** What Taal has after it accepted `batch`. */
export function recordSent(
	sent: Record<string, TaalSession>,
	batch: TaalSession[]
): Record<string, TaalSession> {
	const next = { ...sent };
	for (const session of batch)
		if (TAAL_MODES.some((mode) => session[mode] !== undefined)) next[session.id] = session;
		else delete next[session.id];
	return next;
}
