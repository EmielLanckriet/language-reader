// Scores texts against the reader's restored library, one JSON request per stdin line, one JSON
// answer per stdout line. Used by generate-story.py inside its generation loop (with the
// dictionary analyzer, which loads no model, so it can run beside the language model) and for the
// final measurement (with the shipped segmenter).
//
//   node scripts/content-prototypes/score-server.mjs BACKUP CACHE.sqlite dictionary|bert
//
// Requests: {"words": true} → due and known words (with general frequency rank);
//           {"text": "..."} → the measurement of that text (lib/app.mjs scoreText).
// The library itself is always the one restored with the shipped segmenter (CACHE.sqlite from
// check-library.mjs), so due and known are the same whichever analyzer splits the text.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
	openApp,
	bertAnalyzer,
	bertStamp,
	dictionaryAnalyzer,
	restoreLibrary,
	scorer
} from './lib/app.mjs';

const [backup, cache, which = 'dictionary'] = process.argv.slice(2);
const app = await openApp();
const bert = which === 'bert' ? await bertAnalyzer(app.load) : await bertStamp(app.load);
const { db, repository } = await restoreLibrary(app.load, backup, bert, cache);
const analyzer = which === 'bert' ? bert : await dictionaryAnalyzer(app.load);
const s = await scorer(app.load, db, repository, analyzer);

const rank = new Map(
	readFileSync(
		fileURLToPath(new URL('../../src/lib/domain/frequency-zh.txt', import.meta.url)),
		'utf8'
	)
		.split('\n')
		.filter((line) => line && !line.startsWith('#'))
		.map((word, i) => [word, i])
);

const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
	if (!line.trim()) continue;
	const request = JSON.parse(line);
	let answer;
	if (request.words) {
		answer = {
			due: s.dueWords().map((d) => ({ ...d, rank: rank.get(d.surface) ?? null })),
			known: s.knownWords().map((surface) => ({ surface, rank: rank.get(surface) ?? null }))
		};
	} else {
		const r = await s.score(request.text, request.title ?? 'story');
		answer = { ...request, ...r };
	}
	process.stdout.write(JSON.stringify(answer) + '\n');
}
await app.close();
