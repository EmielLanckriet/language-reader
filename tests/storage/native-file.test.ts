import { describe, it, expect } from 'vitest';
import {
	applyMigrations,
	loadSqlite,
	transact,
	run,
	type Database
} from '../../src/lib/storage/db';
import { installNativeFile } from '../../src/lib/storage/native-file';

/** What src-tauri/src/store.rs does with a batch: write each chunk, then set the length. */
function replay(start: Uint8Array, batches: ArrayBuffer[]): Uint8Array {
	let file = new Uint8Array(start);
	for (const batch of batches) {
		const view = new DataView(batch);
		expect(view.getUint32(0, true)).toBe(0x31424452);
		const size = Number(view.getBigUint64(4, true));
		const count = view.getUint32(12, true);
		const next = new Uint8Array(Math.max(size, file.length));
		next.set(file);
		let at = 16;
		for (let i = 0; i < count; i++) {
			const offset = Number(view.getBigUint64(at, true));
			const n = view.getUint32(at + 8, true);
			next.set(new Uint8Array(batch, at + 12, n), offset);
			at += 12 + n;
		}
		file = next.slice(0, size);
	}
	return file;
}

/** Where two files first differ, or null: a readable failure without a megabyte diff. */
function firstDifference(a: Uint8Array, b: Uint8Array): string | null {
	if (a.length !== b.length) return `length ${a.length} vs ${b.length}`;
	const i = a.findIndex((byte, at) => byte !== b[at]);
	return i === -1 ? null : `byte ${i}`;
}

let vfsCount = 0;

async function openOn(initial: Uint8Array) {
	const sqlite3 = await loadSqlite();
	const batches: ArrayBuffer[] = [];
	const vfs = `native-test-${vfsCount++}`;
	installNativeFile(sqlite3, '/reader.sqlite3', initial, (b) => batches.push(b), vfs);
	const db = new sqlite3.oo1.DB({ filename: '/reader.sqlite3', vfs }) as Database;
	const disk = () => sqlite3.capi.sqlite3_js_db_export(db);
	return { db, batches, disk };
}

function write(db: Database, n: number, size: number) {
	transact(db, () => {
		for (let i = 0; i < n; i++)
			run(db, 'INSERT INTO blob_test (body) VALUES (?)', [new Uint8Array(size).fill(i % 251)]);
	});
}

describe('the native file', () => {
	it('puts exactly the committed database on disk after every commit, and after a crash', async () => {
		const { db, batches, disk } = await openOn(new Uint8Array(0));
		applyMigrations(db);
		db.exec('CREATE TABLE blob_test (id INTEGER PRIMARY KEY, body BLOB)');
		const snapshots: { batches: number; bytes: Uint8Array }[] = [];
		const commit = (work: () => void) => {
			work();
			snapshots.push({ batches: batches.length, bytes: disk() });
		};
		commit(() => write(db, 50, 3000));
		commit(() => write(db, 5, 200_000)); // overflow pages, the file grows by megabytes
		commit(() => db.exec('DELETE FROM blob_test WHERE id % 2 = 0'));
		commit(() => db.exec('VACUUM')); // the file shrinks: a truncate must reach the disk
		expect(() =>
			transact(db, () => {
				for (let i = 0; i < 3; i++)
					run(db, 'INSERT INTO blob_test (body) VALUES (?)', [new Uint8Array(100_000)]);
				throw new Error('rolled back');
			})
		).toThrow('rolled back');
		commit(() => write(db, 2, 10));

		for (const s of snapshots)
			expect(
				firstDifference(replay(new Uint8Array(0), batches.slice(0, s.batches)), s.bytes)
			).toBeNull();
		// A crash before the last batch arrived leaves the commit before it, whole.
		const beforeLast = snapshots.at(-2)!;
		expect(
			firstDifference(
				replay(new Uint8Array(0), batches.slice(0, beforeLast.batches)),
				beforeLast.bytes
			)
		).toBeNull();
		db.close();
	});

	it('reopens from what is on disk and keeps writing on top of it', async () => {
		const first = await openOn(new Uint8Array(0));
		applyMigrations(first.db);
		first.db.exec('CREATE TABLE blob_test (id INTEGER PRIMARY KEY, body BLOB)');
		write(first.db, 20, 5000);
		const onDisk = replay(new Uint8Array(0), first.batches);
		first.db.close();

		const second = await openOn(onDisk);
		applyMigrations(second.db);
		write(second.db, 20, 5000);
		expect(second.db.selectValue('SELECT count(*) FROM blob_test')).toBe(40);
		expect(firstDifference(replay(onDisk, second.batches), second.disk())).toBeNull();
		second.db.close();
	});
});
