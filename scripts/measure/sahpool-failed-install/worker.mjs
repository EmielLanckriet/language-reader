import sqlite3InitModule from '../../../node_modules/@sqlite.org/sqlite-wasm/dist/index.mjs';
import { guardPoolDirectory } from '../../../src/lib/storage/pool-guard.ts';

const params = new URL(import.meta.url).searchParams;
const step = params.get('step');
if (params.has('guard')) guardPoolDirectory();

async function files() {
	const names = [];
	async function walk(dir, path) {
		for await (const [name, handle] of dir.entries()) {
			if (handle.kind === 'directory') await walk(handle, `${path}${name}/`);
			else names.push(path + name);
		}
	}
	await walk(await navigator.storage.getDirectory(), '');
	return names.length ? names.join(', ') : 'none';
}

const sqlite = await sqlite3InitModule();
try {
	if (step === 'create') {
		const pool = await sqlite.installOpfsSAHPoolVfs({});
		const db = new pool.OpfsSAHPoolDb('/reader.sqlite3');
		db.exec('CREATE TABLE earned (n); INSERT INTO earned VALUES (1), (2), (3);');
		db.close();
		await pool.pauseVfs();
		postMessage(`3 rows written; files: ${await files()}`);
	} else if (step === 'fail') {
		// The race in #19: a handle is still held when the pool takes its files, and let go by the
		// time the library cleans up. Simulated by refusing the first pool file's access handle (not
		// the library's own API check, which comes first).
		const original = FileSystemFileHandle.prototype.createSyncAccessHandle;
		let refused = false;
		FileSystemFileHandle.prototype.createSyncAccessHandle = function (...args) {
			if (!refused && !this.name.includes('sync-check')) {
				refused = true;
				return Promise.reject(
					new DOMException('held by the previous page', 'NoModificationAllowedError')
				);
			}
			return original.apply(this, args);
		};
		const outcome = await sqlite.installOpfsSAHPoolVfs({}).then(
			() => 'installed',
			(e) => `refused (${e.name})`
		);
		postMessage(`${outcome}; files after: ${await files()}`);
	} else {
		const pool = await sqlite.installOpfsSAHPoolVfs({});
		const db = new pool.OpfsSAHPoolDb('/reader.sqlite3');
		let rows;
		try {
			rows = db.selectValue('SELECT count(*) FROM earned');
		} catch (e) {
			rows = `no table (${e.message.slice(0, 60)})`;
		}
		postMessage(`rows: ${rows}`);
	}
} catch (e) {
	postMessage(`error ${e.name}: ${e.message}`);
}
