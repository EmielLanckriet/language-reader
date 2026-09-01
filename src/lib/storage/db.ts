/**
 * Opening the database, applying migrations, and this device's identity.
 *
 * The only module besides repository.ts permitted to know that SQLite exists (Principle V.4,
 * enforced by tests/architecture/domain-purity.test.ts).
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

/** Where the reader's data ended up, so the interface can say so honestly when it is not OPFS. */
export type Durability = 'opfs' | 'memory';

export interface OpenDatabase {
	db: Database;
	durability: Durability;
	/** Why OPFS was not used, when it was not. Absent when storage is durable. */
	fallbackReason?: string;
}

/**
 * Open the reader's database.
 *
 * **Only ever called from the worker.** The SAH-pool VFS needs
 * `FileSystemFileHandle.createSyncAccessHandle()`, which is `[Exposed=DedicatedWorker]` and simply
 * absent on the main thread — call this there and it falls back to memory every time. It is used
 * rather than the plain OPFS VFS because it needs no COOP/COEP response headers, which matters
 * because the intended host is static and cannot set them.
 *
 * If OPFS is genuinely unavailable the database is opened in memory so the app still runs — but the
 * caller is told, because data that disappears on reload must not look like data that persisted.
 */
export async function openDatabase(): Promise<OpenDatabase> {
	const sqlite = await loadSqlite();

	let opened: OpenDatabase;
	try {
		const pool: SAHPoolUtil = await sqlite.installOpfsSAHPoolVfs({});
		opened = { db: new pool.OpfsSAHPoolDb(DATABASE_FILE), durability: 'opfs' };
	} catch (error) {
		// Why it failed is the whole value of this branch. Falling back silently would leave the
		// reader with an app that works perfectly until they close the tab, and no way to find out
		// why (FR-021). The reason is carried out so the caller can record it.
		opened = {
			db: new sqlite.oo1.DB(':memory:', 'c'),
			durability: 'memory',
			fallbackReason: error instanceof Error ? `${error.name}: ${error.message}` : String(error)
		};
	}

	// Migrating here rather than leaving it to the caller: every caller needs it, and a database
	// handed out before its schema exists fails later, somewhere else, with "no such table".
	applyMigrations(opened.db);
	return opened;
}

/** Whether the browser promised not to evict the reader's data. */
export type Persistence = 'granted' | 'denied' | 'unavailable';

/**
 * Ask the browser not to evict this origin's storage.
 *
 * Without this, OPFS data is "best effort": a browser under storage pressure may delete it, and
 * the reader would open the app to an empty library that looks exactly like data loss, because it
 * is. Chrome grants it readily once a site is installed to the home screen — which is why
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
