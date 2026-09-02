/**
 * The application's one connection to its data.
 *
 * Started lazily and at most once. Every screen asks for the same session rather than starting its
 * own worker, because the SAH-pool VFS takes an exclusive lease on its files: a second connection
 * would not merely be wasteful, it would fail.
 */

import { requestPersistentStorage, type Persistence } from './persistence';
import type { Durability } from './db';
import { RepositoryClient } from './client';

export interface Session {
	repository: RepositoryClient;
	/** Where the data actually went. `memory` means it will not survive a reload. */
	durability: Durability;
	/** Whether the browser promised not to evict it. */
	persistence: Persistence;
	/** Why OPFS was not used, when it was not. */
	fallbackReason?: string;
}

let opening: Promise<Session> | undefined;

export function session(): Promise<Session> {
	opening ??= start();
	return opening;
}

async function start(): Promise<Session> {
	const repository = new RepositoryClient();

	// `StorageManager.persist()` is `[Exposed=Window]`, so this has to happen out here rather than
	// alongside the database — the worker can ask whether persistence was *granted* but cannot ask
	// for it. Requested once, at startup, before anything is written.
	//
	// It comes from persistence.ts rather than db.ts, and `Durability` above is a *type* import.
	// Both matter: a value import from db.ts would pull SQLite onto the main thread, where nothing
	// runs it. Type imports are erased and cost nothing.
	const [opened, persistence] = await Promise.all([repository.opened, requestPersistentStorage()]);

	// Deliberately *not* recorded as a diagnostic. Whether persistence was granted is a steady
	// state, not an event, and the diagnostics view reports it live. Writing a row per page load
	// buried the actual failures under hundreds of copies of the same sentence.

	return {
		repository,
		durability: opened.durability,
		persistence,
		...(opened.fallbackReason ? { fallbackReason: opened.fallbackReason } : {})
	};
}
