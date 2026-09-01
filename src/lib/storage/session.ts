/**
 * The application's one database connection.
 *
 * Opened lazily and at most once. Every screen asks for the same session rather than opening its
 * own, because the SAH-pool VFS takes an exclusive lease on its files: a second connection would
 * not merely be wasteful, it would fail.
 */

import {
	openDatabase,
	requestPersistentStorage,
	type Database,
	type Durability,
	type Persistence
} from './db';
import { Repository } from './repository';
import { recordDiagnostic } from '../diagnostics/log';

export interface Session {
	repository: Repository;
	/** The raw handle, for the diagnostics view. Nothing else should reach for it. */
	db: Database;
	/** Where the data actually went. `memory` means it will not survive a reload. */
	durability: Durability;
	/** Whether the browser promised not to evict it. */
	persistence: Persistence;
}

let opening: Promise<Session> | undefined;

export function session(): Promise<Session> {
	opening ??= start();
	return opening;
}

async function start(): Promise<Session> {
	const { db, durability } = await openDatabase();

	// Asked for once, at startup, before anything is written. The outcome is recorded rather than
	// acted on: there is nothing useful to do about a refusal except tell the reader.
	const persistence = await requestPersistentStorage();

	if (durability === 'memory') {
		recordDiagnostic(
			db,
			'storage',
			'OPFS was unavailable, so the database was opened in memory. Nothing saved will survive a reload.'
		);
	}
	if (persistence !== 'granted') {
		recordDiagnostic(
			db,
			'persistence',
			`The browser did not grant persistent storage (${persistence}). ` +
				`Saved reading may be evicted if the device runs short of space.`
		);
	}

	return { repository: new Repository(db), db, durability, persistence };
}
