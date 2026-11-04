// One Cards grade per word Cards serves today, timed, with the word's encounter count.
import { openApp, dictionaryAnalyzer, restoreLibrary } from '../../content-prototypes/lib/app.mjs';
const [backup, cache] = process.argv.slice(2);
const { load, close } = await openApp();
const { repository, db } = await restoreLibrary(
	load,
	backup,
	await dictionaryAnalyzer(load),
	cache
);
const { queryRows } = await load('/src/lib/storage/db.ts');
const today = repository.cardsToday(50);
const ids = Object.keys(today.words).map(Number);
const rows = [];
for (const id of ids) {
	const n = Number(queryRows(db, 'SELECT count(*) AS n FROM token WHERE lexeme_id = ?', [id])[0].n);
	const t = performance.now();
	repository.recordReview(id, 3, undefined);
	rows.push([performance.now() - t, n, today.words[id]]);
}
rows.sort((a, b) => a[0] - b[0]);
const q = (p) => rows[Math.floor(p * (rows.length - 1))][0].toFixed(0);
console.log(`${rows.length} cards: median ${q(0.5)} ms, p90 ${q(0.9)} ms, max ${q(1)} ms`);
for (const r of rows.slice(-5))
	console.log(`  ${r[0].toFixed(0)} ms  ${r[2]}  (${r[1]} tokens in library)`);
await close();
