/**
 * Termux's reader service: whether it runs, starting it from the app, and noting when Android
 * stopped it.
 *
 * No page can open Termux: Chrome opens only BROWSABLE activities, and Termux has none. Two ways
 * round that (ADR-0025). Reader Start (android/reader-start), a one-screen app that is BROWSABLE,
 * asks Termux to run the service and closes: one tap. Without it, a share: `termux-url-opener`
 * starts the service for the address below and opens `back` again, through Chrome's share panel.
 */

import { SERVICE, VERIFICATION } from '$lib/media/service-address';
const SEEN = 'reader.service';
/** Set once Chrome came back from the Reader Start link because the app is not installed. */
const NO_HELPER = 'reader.noReaderStart';
const NO_HELPER_HASH = '#no-reader-start';

export interface Health {
	/** When the service process started; absent from services older than this field. */
	started?: string;
}

export async function health(): Promise<Health | null> {
	try {
		const response = await fetch(`${SERVICE}/health`, {
			cache: 'no-store',
			signal: AbortSignal.timeout(3000)
		});
		return response.ok ? await response.json() : null;
	} catch {
		return null;
	}
}

async function answers(seconds: number): Promise<boolean> {
	for (let i = 0; i < seconds; i++) {
		if (await health()) return true;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	return false;
}

function stored(key: string): string | null {
	try {
		return localStorage.getItem(key);
	} catch {
		return null;
	}
}

/** Whether to try Reader Start; false once Chrome has fallen back from it on this device. */
export function helperExpected(): boolean {
	return !VERIFICATION && stored(NO_HELPER) === null;
}

/**
 * Whether this page was opened as Chrome's fallback from the Reader Start link, meaning the app is
 * not installed. Chrome loads the fallback as a new page, not a hash change (measured on the
 * emulator), so this is checked on load. Remembered, so the next tap shares instead.
 */
export function cameBackWithoutHelper(): boolean {
	if (typeof location === 'undefined' || location.hash !== NO_HELPER_HASH) return false;
	history.replaceState(history.state, '', location.href.split('#')[0]);
	try {
		localStorage.setItem(NO_HELPER, '1');
	} catch {
		// Then the next tap tries Reader Start again and falls back again: slower, not wrong.
	}
	return true;
}

/** Open Reader Start and wait for the service; false when it did not answer within 20 s. */
export async function startWithHelper(): Promise<boolean> {
	if (VERIFICATION) return false;
	const page = location.href.split('#')[0];
	location.href =
		'intent://start#Intent;scheme=reader-start;package=io.github.emiellanckriet.readerstart;' +
		`S.browser_fallback_url=${encodeURIComponent(page + NO_HELPER_HASH)};end`;
	return answers(20);
}

export function canShareToTermux(): boolean {
	return !VERIFICATION && typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Share the start address to Termux, then wait for the service. False when the reader cancelled
 * the share sheet, or the service did not answer within 30 s of coming back.
 */
export async function startBySharing(): Promise<boolean> {
	if (VERIFICATION) return false;
	try {
		await navigator.share({
			url: `${SERVICE}/start?back=${encodeURIComponent(location.href)}`
		});
	} catch {
		return false;
	}
	return answers(30);
}

interface Seen {
	started?: string;
	lastUp?: string;
	down?: boolean;
}

/**
 * What to write in Diagnostics about the service, given what was seen before and what answers now:
 * once when it is found not running, and once when it has restarted (a new start time), which also
 * catches a restart that happened while Reader was closed. Measures how often Android stops Termux.
 */
export function serviceChange(
	before: Seen,
	now: Health | null,
	at: string
): { seen: Seen; note?: string } {
	if (!now) {
		if (before.down) return { seen: before };
		const since = before.lastUp ? ` (last seen running ${before.lastUp})` : '';
		return {
			seen: { ...before, down: true },
			note: `Termux's reader service isn't running${since}.`
		};
	}
	const seen = { started: now.started, lastUp: at };
	if (before.started && now.started && before.started !== now.started)
		return {
			seen,
			note: `Termux's reader service restarted at ${now.started} (last seen running ${before.lastUp}).`
		};
	return { seen };
}

/** Compare with what was seen last and store the new view; the note, if any, is for Diagnostics. */
export function noteService(now: Health | null): string | undefined {
	let before: Seen = {};
	try {
		before = JSON.parse(localStorage.getItem(SEEN) ?? '{}');
	} catch {
		// A lost note costs one Diagnostics line, nothing more.
	}
	const { seen, note } = serviceChange(before, now, new Date().toISOString());
	try {
		localStorage.setItem(SEEN, JSON.stringify(seen));
	} catch {
		// As above.
	}
	return note;
}
