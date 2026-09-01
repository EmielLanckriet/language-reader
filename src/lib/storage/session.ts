/**
 * The application's one connection to its data.
 *
 * Started lazily and at most once. Every screen asks for the same session rather than starting its
 * own worker, because the SAH-pool VFS takes an exclusive lease on its files: a second connection
 * would not merely be wasteful, it would fail.
 */

import { requestPersistentStorage, type Durability, type Persistence } from './db';
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
	const [opened, persistence] = await Promise.all([repository.opened, requestPersistentStorage()]);

	if (persistence !== 'granted') {
		// Recorded rather than acted on: there is nothing useful to do about a refusal except tell
		// the reader. Chrome grants this readily once a site is installed to the home screen.
		await repository.recordDiagnostic(
			'persistence',
			`The browser did not grant persistent storage (${persistence}). ` +
				`Saved reading may be evicted if the device runs short of space.`
		);
	}

	return {
		repository,
		durability: opened.durability,
		persistence,
		...(opened.fallbackReason ? { fallbackReason: opened.fallbackReason } : {})
	};
}
