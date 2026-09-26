/**
 * Termux's reader service: whether it runs, starting it from the app, and noting when Android
 * stopped it.
 *
 * No page can open Termux (none of its activities is BROWSABLE, so Chrome sends an `intent:` link to
 * the Play Store), but a share can: `termux-url-opener` starts the service for the address below and
 * opens `back` again. It needs Termux's "Display over other apps", or the share waits until Termux
 * is next opened (measured on the emulator).
 */

const SERVICE = 'http://127.0.0.1:8765';
const SEEN = 'reader.service';

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

export function canStartTermux(): boolean {
	return typeof navigator !== 'undefined' && typeof navigator.share === 'function';
}

/**
 * Share the start address to Termux, then wait for the service. False when the reader cancelled
 * the share sheet, or the service did not answer within 30 s of coming back.
 */
export async function startTermux(): Promise<boolean> {
	try {
		await navigator.share({
			url: `${SERVICE}/start?back=${encodeURIComponent(location.href)}`
		});
	} catch {
		return false;
	}
	for (let i = 0; i < 30; i++) {
		if (await health()) return true;
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	return false;
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
