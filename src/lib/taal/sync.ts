import {
	localHourOf,
	recordSent,
	shareOn,
	TAAL_BATCH,
	TAAL_KEEPS_DAYS,
	taalSessions,
	toSend,
	type TaalInputs,
	type TaalSession
} from '$lib/domain/taal';
import { shiftDay, studyDayOf } from '$lib/domain/study';
import { VERIFICATION } from '$lib/media/service-address';
import { session } from '$lib/storage/session';
import { EARNED_CHANGE } from '$lib/storage/client';
import { readDayEnd } from '$lib/ui/hardcore';
import { sendToTaal, TAAL_DOCS, TAAL_URL, TaalCodeError } from './send';

/**
 * Sending this app's share to the reader's Taal challenge (spec 020, ADR-0045), in the background
 * through Taal's connect contract: nothing awaits a send, and a failed one leaves everything
 * pending for the next. Resending is harmless, since a session sent again replaces itself at Taal.
 */

/** Per device, never in the copy: the code from Taal, and from which day this device sends. */
export interface TaalConnection {
	code: string;
	/** The study day of the latest connect: no earlier day is ever sent (FR-011). */
	since: string;
	on: boolean;
}

export type TaalReason = 'offline' | 'refused' | 'failed';

export type TaalStatus =
	| { at: string; ok: true; today: { input: number; study: number; cards: number } }
	| { at: string; ok: false; reason: TaalReason; detail: string };

export interface SendDeps {
	storage: { taalInputs(from: string): Promise<TaalInputs> };
	/** What Taal has from this device, per code. */
	sent: {
		read(code: string): Record<string, TaalSession>;
		write(code: string, sent: Record<string, TaalSession>): void;
	};
	fetch: typeof globalThis.fetch;
	url: string;
	connection: TaalConnection | null;
	timeZone: string;
	dayEndHour: number;
	now: Date;
	online: boolean;
}

/** One send; null when this device does not send. */
export async function sendNow(deps: SendDeps): Promise<TaalStatus | null> {
	const { connection } = deps;
	if (!connection?.on) return null;
	const at = deps.now.toISOString();
	const failed = (reason: TaalReason, detail: string): TaalStatus => ({
		at,
		ok: false,
		reason,
		detail
	});
	if (!deps.online) return failed('offline', 'No network.');
	const dayOf = studyDayOf(deps.timeZone, deps.dayEndHour);
	const today = dayOf(deps.now);
	const first = [connection.since, shiftDay(today, -TAAL_KEEPS_DAYS)].sort()[1];
	const inWindow = (session: { at: number }) => dayOf(new Date(session.at)) >= first;
	// A day label starts within a day of its UTC date in every time zone.
	const sessions = taalSessions(
		await deps.storage.taalInputs(`${shiftDay(first, -1)}T00:00:00.000Z`),
		localHourOf(deps.timeZone)
	);
	let sent = Object.fromEntries(
		Object.entries(deps.sent.read(connection.code)).filter(([, session]) => inWindow(session))
	);
	const pending = toSend(sessions, sent, inWindow);
	for (let i = 0; i < pending.length; i += TAAL_BATCH) {
		const batch = pending.slice(i, i + TAAL_BATCH);
		try {
			await sendToTaal(connection.code, batch, deps.fetch, deps.url);
		} catch (error) {
			if (error instanceof TaalCodeError) return failed('refused', error.message);
			// `fetch` rejects with a TypeError when no answer came at all.
			if (error instanceof TypeError)
				return failed('offline', `Taal could not be reached: ${error.message}`);
			return failed('failed', (error as Error).message);
		}
		sent = recordSent(sent, batch);
		deps.sent.write(connection.code, sent);
	}
	return { at, ok: true, today: shareOn(sessions, dayOf, today) };
}

const CONNECTION = 'reader.taal';
const STATUS = 'reader.taalStatus';
const SENT = 'reader.taalSent';
/** Dispatched on `window` when the connection or the status changes. */
export const TAAL_CHANGE = 'reader-taal-change';

function read<T>(key: string): T | null {
	try {
		const text = localStorage.getItem(key);
		return text ? (JSON.parse(text) as T) : null;
	} catch {
		return null;
	}
}

function write(key: string, value: unknown) {
	try {
		if (value === null) localStorage.removeItem(key);
		else localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage unavailable: sending simply stays off on this device.
	}
	window.dispatchEvent(new Event(TAAL_CHANGE));
}

export const taalConnection = () => read<TaalConnection>(CONNECTION);
export const taalStatus = () => read<TaalStatus>(STATUS);

/** A new code, or none, forgets what was sent with the old one, as Taal's own tracker does. */
export function setTaalConnection(connection: TaalConnection | null) {
	if (connection?.code !== taalConnection()?.code) write(SENT, null);
	write(CONNECTION, connection);
	if (!connection?.on) write(STATUS, null);
}

const sentStore: SendDeps['sent'] = {
	read: (code) => {
		const stored = read<{ code: string; sessions: Record<string, TaalSession> }>(SENT);
		return stored?.code === code ? stored.sessions : {};
	},
	write: (code, sessions) => write(SENT, { code, sessions })
};

// A verification build sends to a stand-in on its own origin (serve.mjs), never to Taal.
const url = () => (VERIFICATION ? `${location.origin}/__taal/v1/${TAAL_DOCS}` : TAAL_URL);

// Short in a verification build, so a scenario waits seconds, not minutes, for each send.
const DEBOUNCE_MS = VERIFICATION ? 2_000 : 20_000;
let started = false;

/**
 * Send on opening, on coming back online, and after anything earned changes: a session's study
 * time or answer, a Cards grade, a drill step. A session that is still going keeps putting the
 * send off, so it goes once the reading stops.
 */
export function startSending(): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	window.addEventListener(EARNED_CHANGE, () => requestSend());
	window.addEventListener('online', () => requestSend());
	// A copy releases the storage lease while hidden, and sends nothing then: catch up on return.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') requestSend();
	});
	requestSend(true);
}

let timer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | undefined;
let again = false;

/** Ask for a send soon. Never awaited; `now` skips the wait (Retry, Connect). */
export function requestSend(now = false) {
	if (typeof window === 'undefined' || !taalConnection()?.on) return;
	clearTimeout(timer);
	timer = setTimeout(run, now ? 0 : DEBOUNCE_MS);
}

function run() {
	if (running) {
		again = true;
		return;
	}
	running = (async () => {
		const { repository } = await session();
		const status = await sendNow({
			storage: repository,
			sent: sentStore,
			fetch: globalThis.fetch.bind(globalThis),
			url: url(),
			connection: taalConnection(),
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			dayEndHour: readDayEnd(),
			now: new Date(),
			online: navigator.onLine
		});
		if (status) write(STATUS, status);
	})()
		.catch((error) =>
			write(STATUS, {
				at: new Date().toISOString(),
				ok: false,
				reason: 'failed',
				detail: `The send failed here: ${String(error)}`
			} satisfies TaalStatus)
		)
		.finally(() => {
			running = undefined;
			if (again) {
				again = false;
				run();
			}
		});
}
