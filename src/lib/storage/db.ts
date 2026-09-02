/**
 * Opening the database, applying migrations, and this device's identity.
 *
 * The only module besides repository.ts permitted to know that SQLite exists (Principle V.4,
 * enforced by tests/architecture/domain-purity.test.ts).
 *
 * **Reachable only from the storage worker.** Importing this from the main thread pulls the whole
 * SQLite WebAssembly bundle into a graph that never runs it; `scripts/check-bundle.mjs` fails the
 * build when that happens. `requestPersistentStorage` used to live here and is the reason the rule
 * needed writing down — it is now in persistence.ts, which imports nothing.
 */

import sqlite3InitModule, {
	type Database,
	type Sqlite3Static,
	type SAHPoolUtil,
	type SqlValue
} from '@sqlite.org/sqlite-wasm';

import initialSql from './migrations/001-initial.sql?raw';

export type { Database, SqlValue };

/** One row, as returned by a query. Column names to values, exactly as SQLite reports them. */
export type Row = Record<string, SqlValue>;

/**
 * Run a query and collect its rows.
 *
 * The underlying `exec` is configurable to the point of having eight overloads; this is the one
 * shape this application ever needs, so the awkwardness is paid for once, here.
 */
export function queryRows(db: Database, sql: string, bind: SqlValue[] = []): Row[] {
	const rows: Row[] = [];
	db.exec({
		sql,
		bind,
		rowMode: 'object',
		callback: (row: Row) => {
			rows.push(row);
		}
	});
	return rows;
}

/** Run a statement that returns nothing. */
export function run(db: Database, sql: string, bind: SqlValue[] = []): void {
	db.exec({ sql, bind });
}

/**
 * Run `work` in a transaction, rolling back if it throws.
 *
 * Every write that spans more than one statement goes through this. The history and the projection
 * it feeds must land together or not at all, and allocating a device sequence number outside the
 * transaction that uses it would leave a gap looking exactly like a lost entry.
 */
export function transact<T>(db: Database, work: () => T): T {
	db.exec('BEGIN');
	try {
		const result = work();
		db.exec('COMMIT');
		return result;
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
}

/** The id SQLite assigned to the row just inserted. */
export function lastInsertId(db: Database): number {
	return Number(queryRows(db, 'SELECT last_insert_rowid() AS id')[0].id);
}

/**
 * Migrations are numbered, plain SQL, and applied in order — no ORM and no migration framework.
 * Reading the schema means reading the SQL, which is the point (ADR-0008, Principle VII).
 */
const MIGRATIONS: { version: number; name: string; sql: string }[] = [
	{ version: 1, name: '001-initial', sql: initialSql }
];

/** The database file, inside the origin-private file system. Invisible to the reader. */
const DATABASE_FILE = '/reader.sqlite3';

let sqlite3: Sqlite3Static | undefined;

/** Load the WebAssembly module. Idempotent: the module is loaded at most once per page. */
export async function loadSqlite(): Promise<Sqlite3Static> {
	sqlite3 ??= await sqlite3InitModule();
	return sqlite3;
}

/**
 * Bring a database up to the current schema. Safe to run on every start.
 *
 * Each migration and its version marker are written in one transaction, so a failure half-way
 * leaves the database on the previous version rather than in an invented one.
 */
export function applyMigrations(db: Database): void {
	db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);

	for (const migration of MIGRATIONS) {
		if (alreadyApplied(db, migration.version)) continue;

		transact(db, () => {
			db.exec(migration.sql);
			run(db, 'INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)', [
				migration.version,
				migration.name,
				new Date().toISOString()
			]);
		});
	}
}

function alreadyApplied(db: Database, version: number): boolean {
	return queryRows(db, 'SELECT 1 FROM schema_migration WHERE version = ?', [version]).length > 0;
}

/**
 * Take the OPFS pool, or reacquire it after it was paused.
 *
 * The SAH-pool VFS locks every file it will use when it registers — deliberately, and the library
 * says why: registration is not automatic precisely because one page holding the VFS would stop
 * another page in the same origin from using it. That exclusivity is the whole reason the lease
 * exists.
 *
 * `installOpfsSAHPoolVfs` returns the *same* promise for a given name however often it is called,
 * so reacquiring after a pause is `unpauseVfs()` rather than a second installation.
 *
 * Throws if the pool cannot be taken. There is deliberately **no in-memory fallback**: slice 0 had
 * one, and an application that quietly writes somewhere it will never read from is worse than one
 * that says it cannot write (FR-012).
 */
export async function openPool(): Promise<SAHPoolUtil> {
	const sqlite = await loadSqlite();
	const pool: SAHPoolUtil = await sqlite.installOpfsSAHPoolVfs({});
	if (pool.isPaused()) await pool.unpauseVfs();
	return pool;
}

/** Open the reader's database on a pool that is already held, and bring its schema up to date. */
export function openDatabase(pool: SAHPoolUtil): Database {
	const db = new pool.OpfsSAHPoolDb(DATABASE_FILE);

	// Migrating here rather than leaving it to the caller: every caller needs it, and a database
	// handed out before its schema exists fails later, somewhere else, with "no such table".
	applyMigrations(db);
	return db;
}

/**
 * Give the lease back, so another copy — or the next page of this one — can take it.
 *
 * The order is not a preference. `pauseVfs()` throws if SQLite still has an open handle on the
 * VFS, and the library warns that doing it anyway would be undefined behaviour, so the database is
 * closed first and the pause only attempted afterwards.
 */
export async function closeDatabase(db: Database, pool: SAHPoolUtil): Promise<void> {
	db.close();
	await pool.pauseVfs();
}

/**
 * This installation's identity, created once and then never changed.
 *
 * Stored from the first version even though only one device exists (FR-010c). When a second one
 * appears, merging two histories requires knowing which device produced each entry and in what
 * order — and neither can be reconstructed afterwards. Wall-clock time cannot substitute, because
 * two devices' clocks disagree and nothing records by how much.
 */
export function deviceIdOf(db: Database): string {
	const existing = queryRows(db, 'SELECT id FROM device LIMIT 1');
	if (existing.length > 0) return String(existing[0].id);

	const created = crypto.randomUUID();
	run(db, 'INSERT INTO device (id, next_seq) VALUES (?, 1)', [created]);
	return created;
}

/**
 * Take the next position in this device's sequence.
 *
 * This is what orders the history — exact within a device, and immune to clock drift, clock
 * adjustment and time-zone changes, none of which a wall clock survives. Callers must allocate
 * inside the same transaction as the event they are writing, or a crash between the two leaves a
 * gap that looks like a lost entry.
 */
export function nextDeviceSeq(db: Database, deviceId: string): number {
	const rows = queryRows(db, 'SELECT next_seq FROM device WHERE id = ?', [deviceId]);
	if (rows.length === 0) throw new Error(`no such device: ${deviceId}`);

	run(db, 'UPDATE device SET next_seq = next_seq + 1 WHERE id = ?', [deviceId]);
	return Number(rows[0].next_seq);
}
