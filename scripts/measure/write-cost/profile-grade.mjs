// CPU profile of Cards grades on a restored library. usage: node --cpu-prof --cpu-prof-dir=<dir> profile-grade.mjs <backup> <cache>
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
const words = queryRows(db, `SELECT lexeme_id FROM memory WHERE skill='reading' LIMIT 20`).map(
	(r) => Number(r.lexeme_id)
);
const t = performance.now();
for (const w of words) repository.recordReview(w, 3, undefined);
console.log('per grade', ((performance.now() - t) / words.length).toFixed(1), 'ms');
await close();
