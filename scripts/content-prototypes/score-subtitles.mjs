// Issue #11 prototype: rank downloaded YouTube subtitle tracks for the reader.
//
//   node scripts/content-prototypes/score-subtitles.mjs BACKUP CACHE.sqlite SUBS_DIR INFO.jsonl [bert|dictionary] > ranked.json
//
// SUBS_DIR/<video id>/*.vtt as yt-dlp writes them (`-o 'SUBS_DIR/%(id)s/%(id)s.%(ext)s'`);
// INFO.jsonl one line per video: {id, title, channel, duration, subs: {lang: [...]}, autoZh: {...}}
// (human tracks under `subs`, YouTube's machine ones under `autoZh`). Each video's track is chosen
// as import chooses it (classifyTracks/defaultChoice), its text built as import builds it
// (parseSubtitles, one cue per line), then segmented with the shipped segmenter and measured
// against the restored library (lib/app.mjs).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
	openApp,
	bertAnalyzer,
	bertStamp,
	dictionaryAnalyzer,
	restoreLibrary,
	scorer
} from './lib/app.mjs';

const [backup, cache, subsDir, infoPath, which = 'bert'] = process.argv.slice(2);
const infos = readFileSync(infoPath, 'utf8')
	.split('\n')
	.filter(Boolean)
	.map((line) => JSON.parse(line));

const app = await openApp();
try {
	// The library is always the one restored with the shipped segmenter; `which` splits the texts.
	const bert = which === 'bert' ? await bertAnalyzer(app.load) : await bertStamp(app.load);
	const { db, repository } = await restoreLibrary(app.load, backup, bert, cache);
	const analyzer = which === 'bert' ? bert : await dictionaryAnalyzer(app.load);
	const s = await scorer(app.load, db, repository, analyzer);
	const { classifyTracks, defaultChoice, parseSubtitles } = await app.load(
		'/src/lib/media/subtitles.ts'
	);
	const results = [];
	for (const info of infos) {
		const dir = join(subsDir, info.id);
		const files = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(vtt|srt)$/.test(f)) : [];
		const tracks = files.map((file) => {
			const lang = file.split('.').slice(-2, -1)[0];
			return {
				file,
				lang,
				name: lang,
				kind: info.subs && lang in info.subs ? 'human' : 'automatic',
				text: readFileSync(join(dir, file), 'utf8')
			};
		});
		const chosen = defaultChoice(classifyTracks(tracks)).chinese;
		const base = {
			id: info.id,
			url: `https://www.youtube.com/watch?v=${info.id}`,
			title: info.title,
			channel: info.channel,
			duration: info.duration,
			query: info.query,
			tracks: tracks.map((t) => `${t.lang}:${t.kind}`)
		};
		if (!chosen) {
			results.push({ ...base, chinese: false });
			continue;
		}
		const track = tracks.find((t) => t.file === chosen);
		const text = parseSubtitles(track.text)
			.map((cue) => cue.text)
			.join('\n');
		const t0 = performance.now();
		const r = await s.score(text, info.title);
		results.push({
			...base,
			chinese: true,
			track: `${track.lang}:${track.kind}`,
			traditionalLooking: /[們這說個時來會對們還沒過]/.test(text),
			ms: Math.round(performance.now() - t0),
			...r,
			due: r.due.map(([w, n]) => `${w}×${n}`),
			dueWeek: r.dueWeek.map(([w, n]) => `${w}×${n}`),
			neverMet: r.neverMet.slice(0, 40).map(([w, n]) => `${w}×${n}`),
			setAside: r.setAside.map(([w, n]) => `${w}×${n}`)
		});
		console.error(
			`${info.id} ${track.lang}:${track.kind} words ${r.runningWords} known ${(100 * r.known).toFixed(1)}% due ${r.dueCount} never-met ${r.neverMetCount}`
		);
	}
	console.log(
		JSON.stringify(
			{ scoredAt: new Date().toISOString(), dueNow: s.dueWords().length, results },
			null,
			1
		)
	);
} finally {
	await app.close();
}
