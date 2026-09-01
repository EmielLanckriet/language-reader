import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { loadSqlite, applyMigrations, queryRows, type Database } from '../../src/lib/storage/db';

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
		expect(appliedVersions(db)).toEqual([1]);
	});

	it('is idempotent — applying it twice changes nothing', () => {
		expect(() => applyMigrations(db)).not.toThrow();
		expect(appliedVersions(db)).toEqual([1]);
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
