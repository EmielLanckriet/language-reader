/**
 * A human English track re-cut over the Chinese lines. Some channels' tracks are a sentence-by-
 * sentence translation spread over the Chinese cues' times, its pieces drifting lines behind the
 * Chinese and catching up later (非诚勿扰, 2026-11-10: up to ~30 lines, Chinese stretches left
 * untranslated). The English text stays word for word; only where each line's part starts moves.
 *
 * The English is one run of words; every line takes the next stretch of it (possibly none), chosen
 * together for the whole track (dynamic programming) to fit each line's meanings: dictionary
 * glosses, pinyin (names), digits. The track's own cuts, sentence ends and the line's length break
 * ties. Measured against lines labelled by hand in scripts/measure/recut/ (2026-11-10: 非诚勿扰
 * 69% → 92% of words on their line, worst 25 lines off → 2; Boonie Bears 72% → 93%). Pure.
 */

/** Bumped when recut() places words differently, so a kept result is made again. */
export const RECUT_VERSION = 1;

/** Words of a line's possible English, lower case, stemmed (see `stem`). */
export type Glosses = ReadonlySet<string>;

/** CC-CEDICT's entries for a word, as the dictionary worker holds them. */
export type Entries = (word: string) => readonly { pinyin: string; meaning: string }[] | undefined;

const toneless = (pinyin: string) =>
	pinyin.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toLowerCase();

/**
 * The English words a Chinese line may be translated with: its words' meanings (longest match),
 * their pinyin, two or three characters' pinyin run together (names: 井柏然 "Jing Boran", 海南
 * "Hainan"), and digits and Latin words as they stand.
 */
export function glossesOf(line: string, entries: Entries): Glosses {
	const out = new Set<string>();
	const add = (text: string) => {
		for (const w of text.split(/[^\p{L}\p{N}']+/u)) if (w) out.add(stem(w));
	};
	const chars = Array.from(line);
	const syllables: string[][] = [];
	for (let i = 0; i < chars.length;) {
		let len = Math.min(8, chars.length - i);
		while (len > 1 && !entries(chars.slice(i, i + len).join(''))) len--;
		const word = chars.slice(i, i + len).join('');
		const found = entries(word);
		if (found)
			for (const entry of found) {
				add(entry.meaning);
				out.add(stem(toneless(entry.pinyin)));
			}
		else add(word);
		for (const c of chars.slice(i, i + len))
			syllables.push(entries(c)?.map((entry) => toneless(entry.pinyin)) ?? []);
		i += len;
	}
	for (let i = 0; i < syllables.length; i++)
		for (const a of syllables[i])
			for (const b of syllables[i + 1] ?? []) {
				out.add(stem(a + b));
				for (const c of syllables[i + 2] ?? []) out.add(stem(a + b + c));
			}
	return out;
}

/** Each line's English re-cut, from the track as matched by time and the Chinese lines. */
export function recutTrack(
	pieces: readonly (string | undefined)[],
	chinese: readonly string[],
	entries: Entries
): (string | undefined)[] {
	return recut(
		pieces,
		chinese.map((line) => Array.from(line).length),
		chinese.map((line) => glossesOf(line, entries))
	);
}

export interface RecutWeights {
	/** Per English word that one of the line's glosses names. */
	match: number;
	/** Per word of difference between a line's English and what its length predicts. */
	length: number;
	/** For a line starting where the track started it. */
	kept: number;
	/** For a line starting right after a sentence ended. */
	sentence: number;
	/** For a line starting neither where some line of the track started nor after a sentence. */
	inside: number;
}

export const WEIGHTS: RecutWeights = {
	match: 1,
	length: 0.15,
	kept: 0.6,
	sentence: 0.4,
	inside: 1
};

/** How far (in words) a line's start may move from the track's, and the most words a line takes. */
const REACH = 120;
const LONGEST = 45;

/** Kept with the word before: punctuation on its own, and a contraction cut off ("he 's"). */
const ATTACHES = /^(?:[^\p{L}\p{N}]+|['’](?:s|m|re|ll|ve|d|t)\b.*|n['’]t\b.*)$/iu;
const ENDS_SENTENCE = /[.!?…]["”’)\]]*$/;

const STOP = new Set(
	'a an the of to in on at by for with from and or but so as is are was were be been am it its this that these those there their they them he she his her him i me my we our us you your do does did not no just very too also then than if will would can could should has have had what which who how when where s t ll re ve m d'.split(
		' '
	)
);

/**
 * A word reduced so "guests" meets "guest", "Boran's" meets "boran" and "bicycles" meets
 * "bicycle": an ending off, then a final e, the same for the track's words and the glosses.
 */
export function stem(word: string): string {
	let w = word
		.toLowerCase()
		.normalize('NFD')
		.replace(/[^a-z0-9]/g, '');
	if (w.length > 4 && w.endsWith('ies')) w = `${w.slice(0, -3)}y`;
	else if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
	else if (w.length > 4 && (w.endsWith('ed') || w.endsWith('ly'))) w = w.slice(0, -2);
	else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
	return w.length > 3 && w.endsWith('e') ? w.slice(0, -1) : w;
}

/** The English's words in order, a piece of punctuation on its own kept with the word before it. */
export function wordsOfTrack(pieces: readonly (string | undefined)[]): {
	words: string[];
	/** Where each line's piece started in `words`. */
	starts: number[];
} {
	const words: string[] = [];
	const starts: number[] = [];
	for (const piece of pieces) {
		starts.push(words.length);
		for (const word of (piece ?? '').split(/\s+/).filter(Boolean)) {
			if (ATTACHES.test(word) && words.length > 0) words[words.length - 1] += word;
			else words.push(word);
		}
	}
	return { words, starts };
}

/** The punctuation a word carries in front, which belongs to the word before it. */
function splitLead(word: string): [string, string] {
	const at = word.search(/[\p{L}\p{N}"“'‘(]/u);
	return at <= 0 ? ['', word] : [word.slice(0, at), word.slice(at)];
}

/**
 * Each line's English, re-cut. `pieces` is the track as matched to lines by time (humanByLine),
 * `chars` each Chinese line's length, `glosses` each line's possible English words.
 */
export function recut(
	pieces: readonly (string | undefined)[],
	chars: readonly number[],
	glosses: readonly Glosses[],
	weights: RecutWeights = WEIGHTS
): (string | undefined)[] {
	const n = pieces.length;
	const { words, starts } = wordsOfTrack(pieces);
	const m = words.length;
	if (n === 0 || m === 0) return [...pieces];
	const stems = words.map(stem);
	const content = stems.map((s) => s.length > 0 && !STOP.has(s));
	const endsSentence = words.map((w) => ENDS_SENTENCE.test(w));
	const totalChars = chars.reduce((a, b) => a + b, 0) || 1;
	const perChar = m / totalChars;
	const seams = new Set(starts);

	// Where line i may start: a window around the track's own start, never past the end.
	const lo = starts.map((s) => Math.max(0, s - REACH));
	const hi = starts.map((s) => Math.min(m, s + REACH));
	lo[0] = hi[0] = 0;

	// cost[i][k]: best cost of lines 0..i-1 with line i starting at word lo[i] + k.
	const cost: Float64Array[] = [];
	const from: Int32Array[] = [];
	for (let i = 0; i <= n; i++) {
		const width = i === n ? 1 : hi[i] - lo[i] + 1;
		cost.push(new Float64Array(width).fill(Infinity));
		from.push(new Int32Array(width).fill(-1));
	}
	cost[0][0] = 0;
	const startOf = (i: number, k: number) => (i === n ? m : lo[i] + k);

	for (let i = 0; i < n; i++) {
		const expected = chars[i] * perChar;
		for (let k = 0; k < cost[i].length; k++) {
			const base = cost[i][k];
			if (base === Infinity) continue;
			const p = startOf(i, k);
			// Line i takes words p..q-1; line i+1 starts at q.
			const nextLo = i + 1 === n ? m : lo[i + 1];
			const nextHi = i + 1 === n ? m : hi[i + 1];
			let matched = 0;
			for (let q = p; q <= Math.min(nextHi, p + LONGEST); q++) {
				if (q > p && content[q - 1] && glosses[i].has(stems[q - 1])) matched++;
				if (q < nextLo) continue;
				let c = base - weights.match * matched + weights.length * Math.abs(q - p - expected);
				if (i + 1 < n) {
					if (q === starts[i + 1]) c -= weights.kept;
					if (q > 0 && endsSentence[q - 1]) c -= weights.sentence;
					else if (!seams.has(q)) c += weights.inside;
				}
				const j = i + 1 === n ? 0 : q - lo[i + 1];
				if (c < cost[i + 1][j]) {
					cost[i + 1][j] = c;
					from[i + 1][j] = k;
				}
			}
		}
	}

	if (cost[n][0] === Infinity) return [...pieces];
	const cuts = new Array<number>(n + 1);
	cuts[n] = m;
	let k = 0;
	for (let i = n; i > 0; i--) {
		k = from[i][k];
		cuts[i - 1] = startOf(i - 1, k);
	}

	// A line's text; punctuation leading its first word goes back to the line before.
	const texts = Array.from({ length: n }, (_, i) => words.slice(cuts[i], cuts[i + 1]));
	for (let i = 1; i < n; i++) {
		const first = texts[i][0];
		if (first === undefined) continue;
		const [lead, rest] = splitLead(first);
		if (!lead) continue;
		let back = i - 1;
		while (back >= 0 && texts[back].length === 0) back--;
		if (back < 0) continue;
		texts[back][texts[back].length - 1] += lead;
		texts[i][0] = rest;
	}
	return texts.map((t) => (t.length > 0 ? t.join(' ') : undefined));
}
