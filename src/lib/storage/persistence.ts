/**
 * Asking the browser not to evict the reader's data.
 *
 * This lives apart from db.ts for a reason that is easy to lose: it has nothing to do with SQLite,
 * and db.ts imports the entire SQLite WebAssembly bundle at its top level. While this function sat
 * there, the one main-thread module that needed it -- session.ts -- dragged 1.08 MB of WebAssembly
 * and glue into the main-thread graph, to be fetched on every load and never executed. Slice 1
 * precaches the build, which would have made that a cost paid on every install and every version
 * change rather than once.
 *
 * So the rule this file exists to keep is: **nothing on the main thread imports db.ts.** Only the
 * storage worker does. `scripts/check-bundle.mjs` fails the build if that stops being true.
 *
 * It also happens to belong here on the merits. `StorageManager.persist()` is `[Exposed=Window]`
 * and cannot be called from a worker at all, so this is the one piece of storage concern that
 * *must* run on the main thread -- the exact opposite of everything in db.ts.
 */

/** Whether the browser promised not to evict the reader's data. */
export type Persistence = 'granted' | 'denied' | 'unavailable';

/**
 * Ask the browser not to evict this origin's storage.
 *
 * Without this, on-device data is "best effort": a browser under storage pressure may delete it,
 * and the reader would open the app to an empty library that looks exactly like data loss, because
 * it is. Chrome grants it readily once a site is installed to the home screen — which is why
 * installability stops being optional the moment slice 1's data is worth keeping.
 *
 * Returns rather than throws. A refusal is information to show the reader, not a failure to start.
 */
export async function requestPersistentStorage(): Promise<Persistence> {
	if (typeof navigator === 'undefined' || !navigator.storage?.persist) return 'unavailable';
	try {
		if (await navigator.storage.persisted()) return 'granted';
		return (await navigator.storage.persist()) ? 'granted' : 'denied';
	} catch {
		return 'unavailable';
	}
}
