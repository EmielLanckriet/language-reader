/**
 * Whether the reader's work is protected right now, safeguard by safeguard (spec 005, FR-011).
 * Computed each time it is shown; nothing here is stored.
 */

import { health, noteService } from '$lib/media/service';
import { session } from '$lib/storage/session';
import { lastSent } from './destination';
import { waitingSince } from './scheduler';

/** SC-002's bound: a change not copied after this long is unprotected. */
export const STALE_AFTER = 5 * 60_000;
/** Termux away with a copy younger than this is not worth a warning: nothing much is at risk. */
export const AWAY_QUIETLY = 24 * 60 * 60_000;

/**
 * The browser this copy runs in, when it is not Chrome: each browser keeps its own storage, so an
 * install from another one is a second, separate Reader. On 2026-09-28 an old Samsung Internet
 * install with an identical icon was opened by mistake, and looked like the library had been lost.
 * Other browsers are named rather than Chrome required, since Chrome's own name varies (headless).
 */
export function otherBrowser(userAgent: string): string | null {
	const known: [RegExp, string][] = [
		[/SamsungBrowser/, 'Samsung Internet'],
		[/Firefox|FxiOS/, 'Firefox'],
		[/EdgA|Edg\//, 'Edge'],
		[/OPR\/|Opera/, 'Opera'],
		[/YaBrowser/, 'Yandex Browser'],
		[/DuckDuckGo/, 'DuckDuckGo'],
		[/Brave/, 'Brave']
	];
	return known.find(([pattern]) => pattern.test(userAgent))?.[1] ?? null;
}

export interface Safeguards {
	/** Set when this copy runs in a browser other than Chrome, where the reader's library is not. */
	browser: string | null;
	/** Opened as an installed app, not a tab or shortcut: the state in which Chrome keeps storage. */
	installed: boolean;
	/** The browser promised not to evict the app's storage. */
	persisted: boolean;
	/** 'away': the service is not running, but the last copy is under a day old. */
	copy: 'current' | 'stale' | 'away' | 'unreachable';
	lastCopy: { at: number; bytes: number } | null;
}

export async function safeguards(): Promise<Safeguards> {
	const since = waitingSince();
	const up = await health();
	const note = noteService(up);
	if (note) void (await session()).repository.recordDiagnostic('termux', note);
	const last = lastSent();
	return {
		browser: otherBrowser(navigator.userAgent),
		installed: matchMedia('(display-mode: standalone)').matches,
		// The app's own request, awaited: asking `persisted()` directly on start raced it, and a
		// freshly opened install briefly claimed to be a shortcut.
		persisted: (await session()).persistence === 'granted',
		copy: !up
			? last && Date.now() - last.at < AWAY_QUIETLY
				? 'away'
				: 'unreachable'
			: since !== null && Date.now() - since > STALE_AFTER
				? 'stale'
				: 'current',
		lastCopy: last
	};
}
