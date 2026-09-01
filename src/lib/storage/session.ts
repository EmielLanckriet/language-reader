/**
 * The application's one database connection.
 *
 * Opened lazily and at most once. Every screen asks for the same session rather than opening its
 * own, because the SAH-pool VFS takes an exclusive lease on its files: a second connection would
 * not merely be wasteful, it would fail.
 */

import { openDatabase, type Durability } from './db';
import { Repository } from './repository';

export interface Session {
	repository: Repository;
	/** Where the data actually went. `memory` means it will not survive a reload. */
	durability: Durability;
}

let opening: Promise<Session> | undefined;

export function session(): Promise<Session> {
	opening ??= start();
	return opening;
}

async function start(): Promise<Session> {
	const { db, durability } = await openDatabase();
	return { repository: new Repository(db), durability };
}
