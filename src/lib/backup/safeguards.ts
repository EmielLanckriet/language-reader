/**
 * Whether the reader's work is protected right now, safeguard by safeguard (spec 005, FR-011).
 * Computed each time it is shown; nothing here is stored.
 */

import { session } from '$lib/storage/session';
import { lastSent } from './destination';
import { waitingSince } from './scheduler';

/** SC-002's bound: a change not copied after this long is unprotected. */
export const STALE_AFTER = 5 * 60_000;

export interface Safeguards {
	/** Opened as an installed app, not a tab or shortcut: the state in which Chrome keeps storage. */
	installed: boolean;
	/** The browser promised not to evict the app's storage. */
	persisted: boolean;
	copy: 'current' | 'stale' | 'unreachable';
	lastCopy: { at: number; bytes: number } | null;
}

async function serviceUp(): Promise<boolean> {
	try {
		return (await fetch('http://127.0.0.1:8765/health', { cache: 'no-store' })).ok;
	} catch {
		return false;
	}
}

export async function safeguards(): Promise<Safeguards> {
	const since = waitingSince();
	return {
		installed: matchMedia('(display-mode: standalone)').matches,
		// The app's own request, awaited: asking `persisted()` directly on start raced it, and a
		// freshly opened install briefly claimed to be a shortcut.
		persisted: (await session()).persistence === 'granted',
		copy: !(await serviceUp())
			? 'unreachable'
			: since !== null && Date.now() - since > STALE_AFTER
				? 'stale'
				: 'current',
		lastCopy: lastSent()
	};
}
