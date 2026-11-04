// An increment after one Cards grade, against the full copy, on a restored real library (ADR-0048).
// usage: node scripts/measure/write-cost/increment.mjs <backup.json> [cache.sqlite]
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
const { seal, sealPiece } = await load('/src/lib/backup/format.ts');

const ms = async (f) => {
	const t = performance.now();
	const value = await f();
	return [performance.now() - t, value];
};
const [full, { body, cursor }] = await ms(() => repository.exportCopy('x', 'base'));
const [sealFull] = await ms(() => seal(body));
const word = Number(
	queryRows(db, `SELECT lexeme_id FROM memory WHERE skill='reading' LIMIT 1`)[0].lexeme_id
);
const runs = [];
let at = cursor;
for (let i = 0; i < 7; i++) {
	repository.recordReview(word, 3, undefined);
	const [t, next] = await ms(() => repository.exportIncrement('x', `inc${i}`, at));
	const [s, sealed] = await ms(() => sealPiece({ ...next.increment, documents: [] }));
	runs.push([t, s, JSON.stringify(sealed).length]);
	at = next.cursor;
}
runs.sort((a, b) => a[0] + a[1] - b[0] - b[1]);
const [t, s, bytes] = runs[3];
console.log(`full copy: export ${full.toFixed(0)} ms + seal ${sealFull.toFixed(0)} ms`);
console.log(
	`increment after one grade (median of 7): export ${t.toFixed(1)} ms + seal ${s.toFixed(1)} ms, ${bytes} bytes`
);
await close();
