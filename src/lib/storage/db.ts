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

		db.exec('BEGIN');
		try {
			db.exec(migration.sql);
			run(db, 'INSERT INTO schema_migration (version, name, applied_at) VALUES (?, ?, ?)', [
				migration.version,
				migration.name,
				new Date().toISOString()
			]);
			db.exec('COMMIT');
		} catch (error) {
			db.exec('ROLLBACK');
			throw error;
		}
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
}

/**
 * Open the reader's database.
 *
 * Uses the SAH-pool VFS rather than the plain OPFS one: it runs on the main thread and needs no
 * COOP/COEP response headers, which matters because the intended host is static and cannot set
 * them. If OPFS is unavailable the database is opened in memory so the app still runs — but the
 * caller is told, because data that disappears on reload must not look like data that persisted.
 */
export async function openDatabase(): Promise<OpenDatabase> {
	const sqlite = await loadSqlite();

	try {
		const pool: SAHPoolUtil = await sqlite.installOpfsSAHPoolVfs({});
		return { db: new pool.OpfsSAHPoolDb(DATABASE_FILE), durability: 'opfs' };
	} catch {
		return { db: new sqlite.oo1.DB(':memory:', 'c'), durability: 'memory' };
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
