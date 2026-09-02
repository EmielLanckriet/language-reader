/**
 * The application's one connection to its data.
 *
 * Started lazily and at most once. Every screen asks for the same session rather than starting its
 * own worker, because the storage lease is exclusive: a second connection from the same page would
 * not merely be wasteful, it would be a copy of this application competing with itself.
 */

import { browser } from '$app/environment';
import { requestPersistentStorage, type Persistence } from './persistence';
import { RepositoryClient } from './client';

export interface Session {
	repository: RepositoryClient;
	/** Whether the browser promised not to evict what is stored. */
	persistence: Persistence;
}

let opening: Promise<Session> | undefined;

export function session(): Promise<Session> {
	opening ??= start();
	return opening;
}

async function start(): Promise<Session> {
	const repository = new RepositoryClient();

	// The worker holds the storage lease only while someone is looking at this copy, and it cannot
	// see that for itself — `document.visibilityState` is `[Exposed=Window]`. So the page tells it,
	// now and on every change.
	//
	// `pagehide` is here as well as `visibilitychange`, and it is the one that matters most. A
	// navigation inside the application does not always change visibility, but it does fire
	// `pagehide`; without it the outgoing page keeps the lease while the incoming page is already
	// trying to take it, which is precisely the race that made an ordinary navigation lose data
	// during slice 1's implementation.
	if (browser) {
		const tell = () => repository.setVisible(document.visibilityState === 'visible');
		document.addEventListener('visibilitychange', tell);
		window.addEventListener('pagehide', () => repository.setVisible(false));
		window.addEventListener('pageshow', tell);
		tell();
	}

	// `StorageManager.persist()` is `[Exposed=Window]`, so this has to happen out here rather than
	// alongside the database — the worker can ask whether persistence was *granted* but cannot ask
	// for it. Requested once, at startup, before anything is written.
	//
	// It comes from persistence.ts rather than db.ts: a value import from db.ts would pull SQLite
	// onto the main thread, where nothing runs it.
	const persistence = await requestPersistentStorage();

	return { repository, persistence };
}
