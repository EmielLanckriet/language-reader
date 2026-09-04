import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
	loadSqlite,
	applyMigrations,
	openDatabase,
	queryRows,
	type Database
} from '../../src/lib/storage/db';
import initialSql from '../../src/lib/storage/migrations/001-initial.sql?raw';

// Invariant 5 of data-model.md. Almost every column checked here supports no capability a reader
// can see in this slice, which is exactly why the check exists: an invisible column is what a
// later refactor removes as dead weight, and the ones below are hedges against changes that would
// otherwise mean fabricating history that was never recorded (ADR-0003).
//
// Presence is only half of it. A column that exists and is never written is a hedge in name only.
// The other half — that a real write populates them — is tests/storage/provenance.test.ts.

type ColumnInfo = { name: string; notnull: number; dflt_value: string | null; pk: number };

function columns(db: Database, table: string): Map<string, ColumnInfo> {
	const rows = queryRows(db, `PRAGMA table_info(${table})`).map((row) => ({
		name: String(row.name),
		notnull: Number(row.notnull),
		dflt_value: row.dflt_value === null ? null : String(row.dflt_value),
		pk: Number(row.pk)
	}));
	return new Map(rows.map((r) => [r.name, r]));
}

function tableNames(db: Database): Set<string> {
	const rows = queryRows(db, "SELECT name FROM sqlite_master WHERE type = 'table'");
	return new Set(rows.map((row) => String(row.name)));
}

function appliedVersions(db: Database): number[] {
	return queryRows(db, 'SELECT version FROM schema_migration ORDER BY version').map((row) =>
		Number(row.version)
	);
}

/** A column is safe from silent emptiness if it cannot be null, or fills itself when omitted. */
function cannotBeSilentlyEmpty(column: ColumnInfo | undefined): boolean {
	return column !== undefined && (column.notnull === 1 || column.dflt_value !== null);
}

describe('the initial migration', () => {
	let db: Database;

	beforeAll(async () => {
		const sqlite3 = await loadSqlite();
		// In memory, not OPFS: the schema is what is under test, not where it is stored.
		db = new sqlite3.oo1.DB(':memory:', 'c');
		applyMigrations(db);
	});

	afterAll(() => db?.close());

	it('creates every table in the data model', () => {
		const tables = tableNames(db);
		for (const table of [
			'lexeme',
			'document',
			'token',
			'word_state',
			'status_event',
			'device',
			'diagnostic'
		]) {
			expect(tables).toContain(table);
		}
	});

	it('records which migrations have been applied', () => {
		expect(tableNames(db)).toContain('schema_migration');
		expect(appliedVersions(db)).toEqual([1, 2]);
	});

	it('is idempotent — applying it twice changes nothing', () => {
		expect(() => applyMigrations(db)).not.toThrow();
		expect(appliedVersions(db)).toEqual([1, 2]);
	});

	it('lets a document say it is part-way through an upgrade, and defaults to saying it is not', () => {
		// ADR-0016. The defaults are the load-bearing part: every document that existed before this
		// migration must read as "no upgrade in progress, every token from the stamp", and it must
		// do so without anything having to visit it.
		const document = columns(db, 'document');

		expect(document.get('upgrade_analyzer')?.notnull).toBe(0);
		expect(document.get('upgrade_version')?.notnull).toBe(0);

		const through = document.get('upgraded_through');
		expect(through?.notnull).toBe(1);
		expect(Number(through?.dflt_value)).toBe(0);
	});

	describe('the hedge columns', () => {
		it('carries an owner on every table holding earned data (FR-013)', () => {
			for (const table of ['document', 'word_state', 'status_event']) {
				expect(cannotBeSilentlyEmpty(columns(db, table).get('user_id'))).toBe(true);
			}
		});

		it('records how a judgment was acquired, on the state and on the history (FR-012)', () => {
			// NOT NULL without a default, deliberately. A default would let a caller that forgot
			// provenance write a plausible-looking lie; this way the insert fails.
			for (const table of ['word_state', 'status_event']) {
				const provenance = columns(db, table).get('provenance');
				expect(provenance).toBeDefined();
				expect(provenance?.notnull).toBe(1);
				expect(provenance?.dflt_value).toBeNull();
			}
		});

		it('records which device produced each history entry, and in what order (FR-010c)', () => {
			const event = columns(db, 'status_event');
			expect(cannotBeSilentlyEmpty(event.get('device_id'))).toBe(true);
			expect(cannotBeSilentlyEmpty(event.get('device_seq'))).toBe(true);
		});

		it('retains what the reader was looking at, nullably and on purpose', () => {
			// These are the evidence a future sense discriminator would need, since same-reading
			// homographs are told apart by context and nothing else. They are nullable because
			// there is not always an occurrence to record — which is a different thing from a
			// column nothing ever fills.
			const event = columns(db, 'status_event');
			for (const name of ['document_id', 'from_offset', 'to_offset', 'observed_pronunciation']) {
				expect(event.get(name)).toBeDefined();
			}
		});

		it('keeps the analyzer identifiable, so tokens can be re-derived (FR-003)', () => {
			const document = columns(db, 'document');
			expect(document.get('analyzer')).toBeDefined();
			expect(document.get('analyzer_version')).toBeDefined();
			expect(document.get('raw_content')).toBeDefined();
			expect(document.get('content_type')).toBeDefined();
		});
	});

	it('anchors token positions on offsets, not on token indices (FR-014)', () => {
		const token = columns(db, 'token');
		expect(token.get('start')).toBeDefined();
		expect(token.get('end')).toBeDefined();
	});

	it('keys word state on a surrogate lexeme id, never on a string (FR-008)', () => {
		const state = columns(db, 'word_state');
		expect(state.get('lexeme_id')?.pk).toBe(1);
		expect(state.get('surface')).toBeUndefined();
	});
});

// This suite migrated a database it created itself, which is a different claim from "the database
// the application actually opens has a schema". It did not, for a while: opening returned a
// connection without migrating it, every test here still passed, and the app failed in a browser
// with "no such table: document". The gap was that nothing tested the real entry point.
//
// Slice 1 changed the shape of that entry point but not this obligation. `openDatabase` now takes a
// pool it is handed rather than installing one, because the lease is acquired and released as the
// reader moves between copies. There is no OPFS in Node, so the pool is stubbed — but the function
// under test is still the one the application calls, and what is asserted is still that opening
// migrates.
describe('the database the application opens', () => {
	it('comes back already migrated, not empty', async () => {
		const sqlite3 = await loadSqlite();
		const pool = {
			OpfsSAHPoolDb: class {
				constructor() {
					return new sqlite3.oo1.DB(':memory:', 'c');
				}
			}
		} as unknown as Parameters<typeof openDatabase>[0];

		const db = openDatabase(pool);
		try {
			expect(() => db.exec('SELECT 1 FROM document')).not.toThrow();
			expect(() => db.exec('SELECT 1 FROM status_event')).not.toThrow();
			expect(() => db.exec('SELECT 1 FROM word_state')).not.toThrow();
		} finally {
			db.close();
		}
	});
});

// The reader's phone already holds a database written by the previous version, with documents and
// marks in it. Every test above starts from nothing, which is the one starting state that device
// will never be in. This one starts where the phone actually is.
describe('upgrading a database that already has a reader in it', () => {
	let sqlite3: Awaited<ReturnType<typeof loadSqlite>>;

	beforeAll(async () => {
		sqlite3 = await loadSqlite();
	});

	/** A database at schema version 1, as the last release left it. */
	function atVersionOne(): Database {
		const db = new sqlite3.oo1.DB(':memory:', 'c');
		db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
      version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
		db.exec(initialSql);
		db.exec(
			`INSERT INTO schema_migration (version, name, applied_at)
       VALUES (1, '001-initial', '2026-09-01T00:00:00.000Z')`
		);
		return db;
	}

	/** A document, a word, and a judgment the reader made about it. */
	function withAReaderInIt(db: Database): void {
		db.exec(
			`INSERT INTO document
         (raw_content, content_type, language, analyzer, analyzer_version, title, created_at)
       VALUES ('我在中国', 'text/plain', 'zh', 'cedict-longest-match-zh', '1-abc', '我在中国', '2026-09-01T00:00:00.000Z')`
		);
		db.exec("INSERT INTO lexeme (id, language, surface) VALUES (7, 'zh', '中国')");
		db.exec("INSERT INTO device (id, next_seq) VALUES ('device-1', 2)");
		db.exec(
			`INSERT INTO status_event
         (lexeme_id, asserted, asserted_at, device_id, device_seq, provenance, user_id)
       VALUES (7, 'known', '2026-09-01T12:00:00.000Z', 'device-1', 1, 'reader', 1)`
		);
		db.exec(
			`INSERT INTO word_state (lexeme_id, state, provenance, user_id)
       VALUES (7, 'known', 'reader', 1)`
		);
	}

	it('adds the upgrade columns without disturbing what was already stored', () => {
		const db = atVersionOne();
		try {
			withAReaderInIt(db);

			applyMigrations(db);

			expect(appliedVersions(db)).toEqual([1, 2]);

			// The document is untouched, and reads as what it is: not mid-upgrade, every token from
			// its own stamp. Nothing had to visit it to make that true.
			const rows = queryRows(db, 'SELECT * FROM document');
			expect(rows).toHaveLength(1);
			expect(rows[0].raw_content).toBe('我在中国');
			expect(rows[0].analyzer).toBe('cedict-longest-match-zh');
			expect(rows[0].upgrade_analyzer).toBeNull();
			expect(rows[0].upgraded_through).toBe(0);

			// The earned data, asserted exactly. This migration only adds columns to `document`, so
			// it cannot reach these tables — but the comment above this block promises a database
			// "with documents and marks in it", and until an audit pointed it out only the document
			// half was true. A later migration in this slice that did touch them would have found
			// nothing here to stop it.
			expect(queryRows(db, 'SELECT * FROM status_event')).toEqual([
				expect.objectContaining({
					lexeme_id: 7,
					asserted: 'known',
					asserted_at: '2026-09-01T12:00:00.000Z',
					device_id: 'device-1',
					device_seq: 1,
					provenance: 'reader',
					user_id: 1
				})
			]);
			expect(queryRows(db, 'SELECT * FROM word_state')).toEqual([
				expect.objectContaining({ lexeme_id: 7, state: 'known', provenance: 'reader', user_id: 1 })
			]);
			expect(queryRows(db, 'SELECT surface FROM lexeme')).toEqual([{ surface: '中国' }]);
		} finally {
			db.close();
		}
	});

	it('is applied once, however often the application starts', () => {
		const db = atVersionOne();
		try {
			withAReaderInIt(db);
			applyMigrations(db);
			applyMigrations(db);
			expect(appliedVersions(db)).toEqual([1, 2]);
		} finally {
			db.close();
		}
	});
});
