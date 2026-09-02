/**
 * Taking and giving back the exclusive right to the reader's data.
 *
 * Runs inside the storage worker, and is the only place that touches a browser API on this path.
 * The decision about what to do lives in availability.ts, which imports nothing; this file performs
 * the two effects that machine can ask for, and reports which of FR-013's causes applies.
 *
 * **The Web Lock here is advisory and nothing rests on it.** Exclusivity is enforced by the VFS,
 * which locks its own files whether or not anyone asks. The lock is taken only so that a refusal
 * can be told apart from a failure — "another copy has it" versus "this device will not do it" —
 * which FR-013 requires because the two call for opposite responses. Treating the lock as the
 * guarantee would be a false one.
 */

import { openPool, openDatabase, closeDatabase, type Database } from './db';
import type { SAHPoolUtil } from '@sqlite.org/sqlite-wasm';
import type { Cause } from './availability';

const LOCK = 'language-reader-storage';

/**
 * How long to keep trying before reporting failure.
 *
 * An ordinary navigation inside the application is the common cause of a first attempt failing: the
 * outgoing page's worker still holds the lease while the incoming page's worker is already running,
 * and the browser frees it a moment later when the old page is discarded. Reported immediately,
 * that window produces a read-only notice blaming "another copy" for what is really this copy's own
 * previous page — which is both wrong and alarming.
 *
 * This is not the background polling FR-015a forbids. That rule is about hunting for storage while
 * the reader is reading; this is one bounded attempt to *start*, and once it ends nothing tries
 * again until the reader does something.
 */
const SETTLE_MS = 4000;
const BETWEEN_TRIES_MS = 150;

let pool: SAHPoolUtil | undefined;
let releaseLock: (() => void) | undefined;

export type Acquired = { ok: true; db: Database } | { ok: false; cause: Cause };

export async function acquire(): Promise<Acquired> {
	const deadline = Date.now() + SETTLE_MS;
	let last: Acquired | undefined;

	do {
		last = await attempt();
		if (last.ok) return last;
		await sleep(BETWEEN_TRIES_MS);
	} while (Date.now() < deadline);

	return last;
}

async function attempt(): Promise<Acquired> {
	const held = await takeLock();

	try {
		pool ??= await openPool();
		if (pool.isPaused()) await pool.unpauseVfs();

		// This is where an unpause that did not really work shows up. `unpauseVfs()` resolves even
		// when it could not reacquire every access handle -- the handles are still held by whoever
		// had them -- and the VFS is then left unregistered, so opening a database fails with
		// "no such vfs: opfs-sahpool". Observed, not theorised: it is what a second window did on
		// the way back to the first.
		return { ok: true, db: openDatabase(pool) };
	} catch (error) {
		await reset();
		giveBackLock();

		const reason = describe(error);

		// The lock was refused, so somebody else in this origin is holding the storage. That is the
		// one cause we can state rather than guess.
		if (!held) return { ok: false, cause: { kind: 'another-copy' } };

		// A half-registered VFS means the files are still spoken for, whatever the lock says --
		// releasing a lock is instant and letting go of file handles is not.
		if (isStillHeldElsewhere(error)) return { ok: false, cause: { kind: 'another-copy' } };

		// The lock was ours and the storage still would not open. Nothing else in this origin is in
		// the way, so this is about the device or the browser.
		if (isStorageRefusal(error)) return { ok: false, cause: { kind: 'unavailable', reason } };

		// Neither could be established. FR-013 says to say so and show what was recorded, rather
		// than name the likelier cause and send the reader to close a window that is not open.
		return { ok: false, cause: { kind: 'unknown', reason } };
	}
}

/**
 * Put the pool back to a known state, so the next try starts from paused rather than from halfway.
 *
 * Everything here is best-effort by nature: the failure being recovered from is one where the
 * library's own view of its state may already be wrong, so a throw while tidying up says nothing
 * new.
 */
async function reset(): Promise<void> {
	try {
		if (pool && !pool.isPaused()) await pool.pauseVfs();
	} catch {
		// Nothing useful to do. The next attempt reinstalls from scratch.
	}
}

export async function release(db: Database | undefined): Promise<void> {
	try {
		if (db && pool) await closeDatabase(db, pool);
	} catch {
		// A failed pause leaves the VFS in a state the library calls undefined, and there is
		// nothing useful to do about it here. The lock is still given back, so another copy can at
		// least find out for itself rather than wait on a copy that has gone.
	} finally {
		giveBackLock();
	}
}

/**
 * Hold the lock for as long as this copy has the storage.
 *
 * `navigator.locks.request` holds the lock until the promise its callback returns settles, so the
 * callback returns one that is resolved by hand later. `ifAvailable` makes a refusal immediate
 * rather than a wait, which is what turns this into a question about *why* rather than a queue.
 */
function takeLock(): Promise<boolean> {
	if (typeof navigator === 'undefined' || !navigator.locks) return Promise.resolve(true);
	if (releaseLock) return Promise.resolve(true);

	return new Promise<boolean>((decided) => {
		void navigator.locks.request(LOCK, { ifAvailable: true }, (lock) => {
			if (!lock) {
				decided(false);
				return;
			}
			return new Promise<void>((done) => {
				releaseLock = done;
				decided(true);
			});
		});
	});
}

function giveBackLock(): void {
	releaseLock?.();
	releaseLock = undefined;
}

/**
 * Whether the failure means the files are still held by another copy.
 *
 * "no such vfs" is the giveaway: the VFS could not register because it could not take back its
 * access handles, which happens for exactly one reason -- something else still has them. Matching
 * on a message is unpleasant and is done because the library reports this as a generic SQLite
 * error rather than as a distinct type.
 */
function isStillHeldElsewhere(error: unknown): boolean {
	return error instanceof Error && /no such vfs/i.test(error.message);
}

function isStorageRefusal(error: unknown): boolean {
	if (!(error instanceof Error)) return false;
	// The names a browser uses when it will not give this origin a synchronous access handle at
	// all: private browsing, storage exhausted, an origin without OPFS.
	return ['SecurityError', 'QuotaExceededError', 'NotAllowedError', 'NotSupportedError'].includes(
		error.name
	);
}

function describe(error: unknown): string {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}
