import { loadSqlite, applyMigrations, type Database } from '../../src/lib/storage/db';

/**
 * A fresh, empty database in memory.
 *
 * In memory rather than OPFS because what these tests examine is the schema and the write paths,
 * not where the bytes end up. OPFS is exercised on the phone, which is where it can actually fail.
 */
export async function freshDatabase(): Promise<Database> {
	const sqlite3 = await loadSqlite();
	const db = new sqlite3.oo1.DB(':memory:', 'c');
	applyMigrations(db);
	return db;
}
