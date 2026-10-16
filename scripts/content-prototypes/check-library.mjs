// Sanity check before scoring anything: restore the backup, then score each library document's own
// text as if it were a candidate. A document the reader has fully watched must show ~0 never-met
// words; its known share should be near the library's own figure on the phone.
//   node scripts/content-prototypes/check-library.mjs BACKUP CACHE.sqlite [bert|dictionary]
import { openApp, bertAnalyzer, dictionaryAnalyzer, restoreLibrary, scorer } from './lib/app.mjs';

const [backup, cache, which = 'bert'] = process.argv.slice(2);
const app = await openApp();
try {
	const analyzer =
		which === 'bert' ? await bertAnalyzer(app.load) : await dictionaryAnalyzer(app.load);
	const t0 = performance.now();
	const { db, repository, fromCache } = await restoreLibrary(app.load, backup, analyzer, cache);
	const { queryRows } = await app.load('/src/lib/storage/db.ts');
	console.error(
		`library ready in ${((performance.now() - t0) / 1000).toFixed(1)} s (cache: ${fromCache})`
	);
	const s = await scorer(app.load, db, repository, analyzer);
	const count = (sql) => Number(queryRows(db, sql)[0].n);
	const due = s.dueWords();
	console.log(
		JSON.stringify({
			lexemes: count('SELECT COUNT(*) n FROM lexeme'),
			withReadingMemory: count(
				`SELECT COUNT(DISTINCT lexeme_id) n FROM memory WHERE skill='reading'`
			),
			encountered: s.encountered.size,
			known: s.knownWords().length,
			dueNow: due.length,
			dueSample: due
				.slice(0, 30)
				.map((d) => d.surface)
				.join(' ')
		})
	);
	for (const { id, title } of repository.listDocuments()) {
		const doc = repository.getDocument(id);
		const r = await s.score(doc.rawContent, `rescored ${id}`);
		console.log(
			[
				id,
				r.runningWords,
				(100 * r.known).toFixed(1),
				(100 * (r.understood ?? 0)).toFixed(1),
				r.dueCount,
				r.neverMetCount,
				r.neverMet
					.slice(0, 6)
					.map(([w, n]) => `${w}×${n}`)
					.join(' '),
				title.slice(0, 40)
			].join('\t')
		);
	}
} finally {
	await app.close();
}
