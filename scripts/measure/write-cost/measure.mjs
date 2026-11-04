// What one write costs with a real library (issues #44, #54): a backup restored in memory, then the
// per-write work (a Cards grade), the per-write refresh (studyOverview) and the full copy timed.
// usage: node scripts/measure/write-cost/measure.mjs <backup.json> [cache.sqlite]
import { openApp, dictionaryAnalyzer, restoreLibrary } from '../../content-prototypes/lib/app.mjs';

const [backup, cache] = process.argv.slice(2);
const { load, close } = await openApp();
const analyzer = await dictionaryAnalyzer(load);
const { repository, db } = await restoreLibrary(load, backup, analyzer, cache);
const { queryRows } = await load('/src/lib/storage/db.ts');
const { seal } = await load('/src/lib/backup/format.ts');

function time(label, f, runs = 5) {
	const ms = [];
	let result;
	for (let i = 0; i < runs; i++) {
		const t = performance.now();
		result = f();
		ms.push(performance.now() - t);
	}
	ms.sort((a, b) => a - b);
	console.log(
		`${label.padEnd(34)} median ${ms[runs >> 1].toFixed(1)} ms  (min ${ms[0].toFixed(1)}, max ${ms.at(-1).toFixed(1)})`
	);
	return result;
}
async function timeAsync(label, f, runs = 3) {
	const ms = [];
	for (let i = 0; i < runs; i++) {
		const t = performance.now();
		await f();
		ms.push(performance.now() - t);
	}
	ms.sort((a, b) => a - b);
	console.log(
		`${label.padEnd(34)} median ${ms[runs >> 1].toFixed(1)} ms  (min ${ms[0].toFixed(1)}, max ${ms.at(-1).toFixed(1)})`
	);
}

const counts = Object.fromEntries(
	['encounter', 'status_event', 'memory', 'lexeme', 'token', 'analyzed_token'].map((t) => [
		t,
		Number(queryRows(db, `SELECT count(*) AS n FROM ${t}`)[0].n)
	])
);
console.log('rows', counts);

const tz = 'Europe/Brussels';
time('studyOverview (per write, library)', () => repository.studyOverview(tz, new Date(), 4));
time('cardsToday(50)', () => repository.cardsToday(50));
const word = Number(
	queryRows(db, `SELECT lexeme_id FROM memory WHERE skill='reading' ORDER BY reps DESC LIMIT 1`)[0]
		.lexeme_id
);
time('recordReview (one Cards grade)', () => repository.recordReview(word, 3, undefined));
const body = time(
	'exportBody (worker, every copy)',
	() => repository.exportBody('x', new Date().toISOString()),
	3
);
await timeAsync('seal = canonical + sha256 (main)', () => seal(body));
time('JSON.stringify of sealed copy', () => JSON.stringify(body), 3);
console.log('copy bytes', JSON.stringify(body).length);
await close();
