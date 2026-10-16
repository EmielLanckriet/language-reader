import sqlite3InitModule from '../../../node_modules/@sqlite.org/sqlite-wasm/dist/index.mjs';
import { guardPoolDirectory } from '../../../src/lib/storage/pool-guard.ts';

const params = new URL(import.meta.url).searchParams;
if (params.has('guard')) guardPoolDirectory();
const sqlite = await sqlite3InitModule();
const step = params.get('step');
if (step === 'hold') {
	const pool = await sqlite.installOpfsSAHPoolVfs({});
	const db = new pool.OpfsSAHPoolDb('/reader.sqlite3');
	db.exec('CREATE TABLE earned (n); INSERT INTO earned VALUES (1), (2), (3);');
	postMessage('holding');
	onmessage = async () => {
		db.close();
		await pool.pauseVfs();
		postMessage('released');
	};
} else if (step === 'install') {
	postMessage('ready');
	await new Promise((go) => (onmessage = go));
	// With ?retry, keep trying as Reader's lease does (every 150 ms); otherwise one attempt.
	const retry = params.has('retry');
	const started = performance.now();
	let outcome = 'refused';
	for (let tries = 1; ; tries++) {
		const pool = await sqlite
			.installOpfsSAHPoolVfs({ forceReinitIfPreviouslyFailed: retry && !params.has('cached') })
			.catch(() => undefined);
		if (pool) {
			await pool.pauseVfs();
			outcome =
				tries === 1
					? 'installed'
					: `installed on try ${tries}, ${Math.round(performance.now() - started)} ms`;
			break;
		}
		if (!retry || performance.now() - started > 4000) break;
		await new Promise((r) => setTimeout(r, 150));
	}
	postMessage(outcome);
} else {
	try {
		const pool = await sqlite.installOpfsSAHPoolVfs({});
		const db = new pool.OpfsSAHPoolDb('/reader.sqlite3');
		let rows;
		try {
			rows = `${db.selectValue('SELECT count(*) FROM earned')} rows`;
		} finally {
			db.close();
			await pool.pauseVfs();
		}
		postMessage(rows);
	} catch (e) {
		postMessage(/no such table/.test(e.message) ? 'EMPTY' : `error ${e.name}`);
	}
}
