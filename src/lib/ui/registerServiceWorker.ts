/**
 * Registering the service worker, and holding on to what registering returns.
 *
 * SvelteKit registers `src/service-worker.ts` automatically unless told not to, and it is told not
 * to (`serviceWorker: { register: false }` in vite.config.ts). The reason is FR-010: the reader
 * must be told when a new version is ready and move to it by an explicit action, and doing that
 * needs the `ServiceWorkerRegistration` — specifically its `waiting` worker, which is the one to
 * activate. Automatic registration does not hand it back.
 *
 * Started at most once, like `session()` in the storage layer, and for the same reason: every part
 * of the interface that wants it should be asking about the same registration.
 */

import { base } from '$app/paths';
import { dev } from '$app/environment';

let registering: Promise<ServiceWorkerRegistration | undefined> | undefined;

/**
 * Resolves to the registration, or to `undefined` where service workers are unavailable.
 *
 * Returns rather than throws when unsupported. A browser without service workers cannot read
 * offline and cannot be installed, but it can still read online, and refusing to start would take
 * away the working part along with the missing one.
 */
export function serviceWorker(): Promise<ServiceWorkerRegistration | undefined> {
	registering ??= register();
	return registering;
}

async function register(): Promise<ServiceWorkerRegistration | undefined> {
	if (!('serviceWorker' in navigator)) return undefined;

	try {
		// A module worker in development, where it is served unbundled, and a classic script in
		// production, where the build has bundled it. This asymmetry is SvelteKit's, not ours.
		return await navigator.serviceWorker.register(`${base}/service-worker.js`, {
			type: dev ? 'module' : 'classic'
		});
	} catch (error) {
		// Worth seeing, and not worth stopping for: without this the application still works while
		// there is a network, which is strictly better than not starting.
		console.error('[service-worker] registration failed', error);
		return undefined;
	}
}
