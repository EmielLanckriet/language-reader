/**
 * When a copy goes out (research R4): 30 s after the reader stops changing things, when the app goes
 * to the background, and at least every 5 minutes while something is unsent. One copy is sent on
 * start too, so work from before this slice, or from a session that ended abruptly, is covered.
 */

import { EARNED_CHANGE } from '$lib/storage/client';
import { makeCopy, send } from './destination';

/** Overridable for the browser harness, so a wipe check takes seconds rather than minutes. */
function delays(): { quiet: number; every: number } {
	try {
		const set = JSON.parse(localStorage.getItem('reader.copyDelays') ?? 'null');
		if (set && typeof set.quiet === 'number' && typeof set.every === 'number') return set;
	} catch {
		// Defaults below.
	}
	return { quiet: 30_000, every: 5 * 60_000 };
}

let started = false;
let unsentSince: number | null = Date.now();

/** Since when a change has waited to be copied, or null when the latest copy has everything. */
export function waitingSince(): number | null {
	return unsentSince;
}

export function startCopying(): void {
	if (started || typeof window === 'undefined') return;
	started = true;
	const { quiet, every } = delays();
	let sending = false;
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function flush() {
		if (unsentSince === null || sending) return;
		sending = true;
		try {
			const since = unsentSince;
			if (await send(await makeCopy())) unsentSince = unsentSince === since ? null : unsentSince;
		} catch {
			// Not sent: stays unsent, and the safeguard notice turns stale after the bound.
		} finally {
			sending = false;
		}
	}

	window.addEventListener(EARNED_CHANGE, () => {
		unsentSince ??= Date.now();
		clearTimeout(timer);
		timer = setTimeout(() => void flush(), quiet);
	});
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') void flush();
	});
	setInterval(() => void flush(), every);
	timer = setTimeout(() => void flush(), quiet);
}
