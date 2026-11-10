/**
 * How well recut() places a human English track's words on the Chinese lines, against lines
 * labelled by hand. Per English word: how many lines from its labelled line it lands.
 *
 *   node scripts/measure/recut/run.ts <zh.vtt> <en.vtt> <labels.tsv | -> [--show a-b]
 *
 * Without labels (-), it lists the lines whose English recut changes.
 *
 * The tracks are YouTube's (not in the repo); 非诚勿扰's are in ~/reader-data/videos/subs/Hd6Z3paEZb8.
 */
import { readFileSync } from 'node:fs';
import { parseSubtitles } from '../../../src/lib/media/subtitles.ts';
import { humanByLine } from '../../../src/lib/translation/lines.ts';
import { recutTrack, wordsOfTrack } from '../../../src/lib/translation/recut.ts';

const [zhPath, enPath, labelPath, ...rest] = process.argv.slice(2);
const show = rest[0] === '--show' ? rest[1].split('-').map(Number) : undefined;

const zh = parseSubtitles(readFileSync(zhPath, 'utf8'));
const en = parseSubtitles(readFileSync(enPath, 'utf8'), { keepRepeats: true });
const pieces = humanByLine(zh, en);

// --- CC-CEDICT, as the dictionary worker holds it ---
const dictionary = new Map<string, { pinyin: string; meaning: string }[]>();
for (const row of readFileSync(
	new URL('../../../static/dictionary-zh.txt', import.meta.url),
	'utf8'
).split('\n')) {
	if (row.startsWith('#') || !row) continue;
	const [word, pinyin, meaning] = row.split('\t');
	dictionary.set(word, [...(dictionary.get(word) ?? []), { pinyin, meaning }]);
}

// --- Labels: the English each line should show ---
const labelled = new Map<number, string>();
for (const row of labelPath === '-' ? [] : readFileSync(labelPath, 'utf8').split('\n')) {
	if (!row || row.startsWith('#')) continue;
	const same = row.match(/^same (\d+) (\d+)$/);
	if (same) for (let i = +same[1]; i <= +same[2]; i++) labelled.set(i, pieces[i] ?? '');
	else {
		const [line, text = ''] = row.split('\t');
		labelled.set(Number(line), text);
	}
}
// Stretches of consecutive labelled lines.
const lines = [...labelled.keys()].sort((a, b) => a - b);
const stretches: [number, number][] = [];
for (const line of lines) {
	const last = stretches.at(-1);
	if (last && last[1] === line - 1) last[1] = line;
	else stretches.push([line, line]);
}

const squash = (words: string[]) => words.join('').replace(/[^\p{L}\p{N}]/gu, '');
/** The line of every letter or digit of a stretch, in order, given each line's English. */
function linesOfLetters(english: (i: number) => string | undefined, [a, b]: [number, number]) {
	const out: number[] = [];
	for (let i = a; i <= b; i++) out.push(...Array(squash([english(i) ?? '']).length).fill(i));
	return out;
}

function score(name: string, english: (string | undefined)[]) {
	// Per stretch, the letters of the track's words in that stretch, by the line each is shown on.
	const { words, starts } = wordsOfTrack(english);
	const lineOfWord: number[] = [];
	starts.forEach((s, i) => {
		const end = starts[i + 1] ?? words.length;
		for (let w = s; w < end; w++) lineOfWord[w] = i;
	});
	const letterLine: number[] = [];
	words.forEach((w, k) => {
		letterLine.push(...Array(squash([w]).length).fill(lineOfWord[k]));
	});
	const letterAtLine: number[] = [];
	{
		const track = wordsOfTrack(pieces);
		let at = 0;
		track.starts.forEach((s, i) => {
			letterAtLine[i] = at;
			const end = track.starts[i + 1] ?? track.words.length;
			at += squash(track.words.slice(s, end)).length;
		});
	}
	let total = 0;
	let exact = 0;
	let near = 0;
	let far = 0;
	let sumOff = 0;
	let worst = 0;
	for (const stretch of stretches) {
		const truth = linesOfLetters((i) => labelled.get(i), stretch);
		const offset = letterAtLine[stretch[0]];
		// Count once per labelled word: at its first letter.
		let k = 0;
		for (let i = stretch[0]; i <= stretch[1]; i++)
			for (const w of (labelled.get(i) ?? '').split(/\s+/)) {
				const n = squash([w]).length;
				if (n === 0) continue;
				const off = Math.abs(letterLine[offset + k] - truth[k]);
				total++;
				sumOff += off;
				worst = Math.max(worst, off);
				if (off === 0) exact++;
				if (off <= 1) near++;
				if (off >= 3) far++;
				k += n;
			}
	}
	const pct = (x: number) => `${((100 * x) / total).toFixed(1)}%`;
	console.log(
		`${name.padEnd(10)} words ${total}  exact ${pct(exact)}  within 1 line ${pct(near)}  3+ lines off ${pct(far)}  mean ${(sumOff / total).toFixed(2)}  worst ${worst}`
	);
}

// The labels hold exactly the track's words in each stretch.
{
	const track = wordsOfTrack(pieces);
	let bad = 0;
	for (const [a, b] of stretches) {
		const want = squash(
			track.words.slice(track.starts[a], track.starts[b + 1] ?? track.words.length)
		);
		const got = squash(Array.from({ length: b - a + 1 }, (_, i) => labelled.get(a + i) ?? ''));
		if (want !== got) {
			bad++;
			const at = [...want].findIndex((c, i) => c !== got[i]);
			console.error(
				`labels ${a}-${b} differ from the track at ${at}: …${want.slice(at - 20, at + 20)}… vs …${got.slice(at - 20, at + 20)}…`
			);
		}
	}
	if (bad) process.exit(1);
}

const t0 = performance.now();
const cut = recutTrack(
	pieces,
	zh.map((cue) => cue.text),
	(word) => dictionary.get(word)
);
const ms = performance.now() - t0;
console.log(
	`${zh.length} lines, ${wordsOfTrack(pieces).words.length} words; recut ${ms.toFixed(0)} ms`
);
if (stretches.length > 0) {
	score('track', pieces);
	score('recut', cut);
} else {
	const norm = (s?: string) => wordsOfTrack([s]).words.join(' ');
	const changed = cut.flatMap((c, i) => (norm(c) !== norm(pieces[i]) ? [i] : []));
	console.log(`changed ${changed.length} of ${zh.length} lines`);
}

if (show)
	for (let i = show[0]; i <= show[1]; i++)
		console.log(
			`${i}\t${zh[i].text}\n\t  track: ${pieces[i] ?? ''}\n\t  recut: ${cut[i] ?? ''}${labelled.has(i) ? `\n\t  label: ${labelled.get(i)}` : ''}`
		);
