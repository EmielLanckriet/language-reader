/**
 * How a video's lines are shown, as the reader set them by hand (ADR-0050): where the Chinese is cut
 * into lines, when each line shows, and English they placed on the lines themselves. The document's
 * text never changes, so nothing earned moves; this is the reader's own work, and copies carry it.
 * Replaces sentences.json (joined runs of whole lines), which is read once as joins. Pure.
 */

import type { Cue } from './subtitles';
import type { English } from '$lib/translation/lines';

export const LAYOUT = 'layout.json';

/** Before layout.json: runs of whole lines joined, [first, last]. Read once; copies still carry it. */
export const SENTENCES = 'sentences.json';

/** A place in the document's text: `at` code points into line (cue) `line`. */
export interface Pos {
	line: number;
	at: number;
}

/** English placed by hand over the shown lines from the one starting at `from` to `to` (exclusive). */
export interface Placed {
	from: Pos;
	to: Pos;
	text: string;
}

export interface Layout {
	/** Lines of the document shown as part of the line before them. */
	joined: number[];
	/** Where a shown line starts inside a line of the document. */
	cuts: Pos[];
	/** Every line shows this much later (negative: earlier). */
	offsetMs: number;
	/** One shown line, by where it starts, shows this much later. */
	shifts: { at: Pos; ms: number }[];
	/** English placed by hand; absent until the reader first changes the English. */
	english?: Placed[];
}

export const PLAIN: Layout = { joined: [], cuts: [], offsetMs: 0, shifts: [] };

/** A line as the player shows it: from one break to the next. */
export interface Shown {
	from: Pos;
	to: Pos;
	/** Seconds, with the reader's timing applied. */
	start: number;
	end: number;
}

const before = (a: Pos, b: Pos) => a.line < b.line || (a.line === b.line && a.at < b.at);
const same = (a: Pos, b: Pos) => a.line === b.line && a.at === b.at;
const length = (text: string) => Array.from(text).length;

/** A kept layout.json, or sentences.json's joined runs ([first, last] lines) from before it. */
export function layoutOf(kept: unknown, runs?: unknown): Layout {
	if (kept && typeof kept === 'object') {
		const k = kept as Partial<Layout>;
		return {
			joined: Array.isArray(k.joined) ? k.joined : [],
			cuts: Array.isArray(k.cuts) ? k.cuts : [],
			offsetMs: typeof k.offsetMs === 'number' ? k.offsetMs : 0,
			shifts: Array.isArray(k.shifts) ? k.shifts : [],
			...(Array.isArray(k.english) ? { english: k.english } : {})
		};
	}
	const joined = Array.isArray(runs)
		? (runs as [number, number][]).flatMap(([a, b]) =>
				Array.from({ length: Math.max(0, b - a) }, (_, i) => a + 1 + i)
			)
		: [];
	return { ...PLAIN, joined };
}

/** Where each shown line starts, in order. */
function breaksOf(cues: readonly Cue[], layout: Layout): Pos[] {
	const joined = new Set(layout.joined);
	const breaks: Pos[] = [];
	for (let line = 0; line < cues.length; line++) {
		if (line === 0 || !joined.has(line)) breaks.push({ line, at: 0 });
		const len = length(cues[line].text);
		const inside = layout.cuts
			.filter((cut) => cut.line === line && cut.at > 0 && cut.at < len)
			.map((cut) => cut.at)
			.sort((a, b) => a - b);
		for (const at of new Set(inside)) breaks.push({ line, at });
	}
	return breaks;
}

/** When the text at `pos` is heard: within its line, in proportion to the characters before it. */
function timeAt(cues: readonly Cue[], pos: Pos): number {
	const cue = cues[pos.line];
	const len = length(cue.text);
	return len === 0 ? cue.start : cue.start + ((cue.end - cue.start) * pos.at) / len;
}

export function shownOf(cues: readonly Cue[], layout: Layout): Shown[] {
	if (cues.length === 0) return [];
	const breaks = breaksOf(cues, layout);
	const last = cues.length - 1;
	// Past the last line: so every line of the document starts before some shown line's end.
	const end: Pos = { line: cues.length, at: 0 };
	return breaks.map((from, i) => {
		const to = breaks[i + 1] ?? end;
		const shift = (layout.offsetMs + (layout.shifts.find((s) => same(s.at, from))?.ms ?? 0)) / 1000;
		const ends = !breaks[i + 1]
			? cues[last].end
			: to.at === 0
				? cues[to.line - 1].end
				: timeAt(cues, to);
		return {
			from,
			to,
			start: Math.max(0, timeAt(cues, from) + shift),
			end: Math.max(0, ends + shift)
		};
	});
}

/** The shown line `pos` falls in. */
export function shownAt(shown: readonly Shown[], pos: Pos): number {
	let lo = 0;
	let hi = shown.length - 1;
	while (lo < hi) {
		const mid = (lo + hi + 1) >> 1;
		if (before(pos, shown[mid].from)) hi = mid - 1;
		else lo = mid;
	}
	return lo;
}

/** The lines of the document that start in this shown line. */
function ownLines(shown: Shown): number[] {
	const first = shown.from.at === 0 ? shown.from.line : shown.from.line + 1;
	const last = shown.to.at === 0 ? shown.to.line - 1 : shown.to.line;
	return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}

/** The document's own lines with the reader's timing: what the recorder counts in. */
export function timedCues(cues: readonly Cue[], layout: Layout, shown: readonly Shown[]): Cue[] {
	return cues.map((cue, line) => {
		const at = shown[shownAt(shown, { line, at: 0 })];
		const shift =
			(layout.offsetMs + (layout.shifts.find((s) => same(s.at, at.from))?.ms ?? 0)) / 1000;
		return { ...cue, start: Math.max(0, cue.start + shift), end: Math.max(0, cue.end + shift) };
	});
}

const ROUGHNESS: English['source'][] = ['quick', 'llm', 'human', 'edited'];

/**
 * The English of each shown line from the English of each line of the document: the lines starting
 * in it, a sentence repeated across them once; a piece cut off a line shares that line's English.
 */
export function englishShown(
	shown: readonly Shown[],
	english: readonly (English | undefined)[]
): (English | undefined)[] {
	const out: (English | undefined)[] = [];
	shown.forEach((line, s) => {
		const parts = ownLines(line)
			.map((i) => english[i])
			.filter((part): part is English => Boolean(part?.text));
		if (parts.length === 0) {
			const previous = out[s - 1];
			if (previous && line.from.at > 0) {
				out[s - 1] = { ...previous, continues: true };
				out.push({ text: previous.text, source: previous.source });
			} else out.push(undefined);
			return;
		}
		const texts = parts.filter(
			(part, i) => i === 0 || !(parts[i - 1].continues && parts[i - 1].text === part.text)
		);
		const source = ROUGHNESS.find((kind) => parts.some((part) => part.source === kind))!;
		const continues = parts.at(-1)?.continues;
		out.push({
			text: texts.map((part) => part.text).join(' '),
			source,
			...(continues ? { continues } : {})
		});
	});
	return out;
}

// --- English placed by hand, worked on as spans of shown lines ---

/** English over shown lines a..b (inclusive). */
export interface Span {
	a: number;
	b: number;
	text: string;
}

/** Spans in order, overlapping ones joined into one, empty ones gone. */
function tidySpans(spans: readonly Span[]): Span[] {
	const out: Span[] = [];
	for (const span of spans) {
		if (!span.text.trim()) continue;
		const last = out.at(-1);
		if (last && span.a <= last.b)
			out[out.length - 1] = {
				a: last.a,
				b: Math.max(last.b, span.b),
				text: `${last.text} ${span.text}`
			};
		else out.push({ ...span });
	}
	return out;
}

const byStart = (spans: Span[]) => [...spans].sort((x, y) => x.a - y.a);

export function spansOf(placed: readonly Placed[], shown: readonly Shown[]): Span[] {
	if (shown.length === 0) return [];
	return tidySpans(
		byStart(
			placed.map((p) => ({
				a: shownAt(shown, p.from),
				b: Math.max(shownAt(shown, p.from), shownBefore(shown, p.to)),
				text: p.text
			}))
		)
	);
}

/** The last shown line starting before `to`. */
function shownBefore(shown: readonly Shown[], to: Pos): number {
	const s = shownAt(shown, to);
	return same(shown[s].from, to) ? s - 1 : s;
}

export function placedOf(spans: readonly Span[], shown: readonly Shown[]): Placed[] {
	return spans.map((span) => ({ from: shown[span.a].from, to: shown[span.b].to, text: span.text }));
}

/** The English shown now, as spans: a sentence across lines (`continues`) is one span. */
export function frozen(english: readonly (English | undefined)[]): Span[] {
	const spans: Span[] = [];
	for (let s = 0; s < english.length; s++) {
		const line = english[s];
		if (!line?.text) continue;
		let b = s;
		while (english[b]?.continues && english[b + 1]?.text === line.text) b++;
		spans.push({ a: s, b, text: line.text });
		s = b;
	}
	return spans;
}

export function englishOfSpans(spans: readonly Span[], count: number): (English | undefined)[] {
	const out: (English | undefined)[] = Array.from({ length: count }, () => undefined);
	for (const span of spans)
		for (let s = span.a; s <= span.b && s < count; s++)
			out[s] = { text: span.text, source: 'edited', ...(s < span.b ? { continues: true } : {}) };
	return out;
}

const spanAt = (spans: readonly Span[], s: number) => spans.findIndex((x) => x.a <= s && s <= x.b);

/** The English of shown line `s` and of the line before or after it become one sentence over both. */
export function joinEnglish(spans: readonly Span[], s: number, way: -1 | 1, count: number): Span[] {
	const here = spanAt(spans, s);
	const mine = here >= 0 ? spans[here] : { a: s, b: s, text: '' };
	const t = way === 1 ? mine.b + 1 : mine.a - 1;
	if (t < 0 || t >= count) return [...spans];
	const there = spanAt(spans, t);
	const theirs = there >= 0 ? spans[there] : { a: t, b: t, text: '' };
	const [first, second] = way === 1 ? [mine, theirs] : [theirs, mine];
	const joined = {
		a: first.a,
		b: second.b,
		text: [first.text, second.text].filter((x) => x.trim()).join(' ')
	};
	if (!joined.text) return [...spans];
	return byStart([...spans.filter((_, i) => i !== here && i !== there), joined]);
}

export function wordsOf(text: string): string[] {
	return text.split(/\s+/).filter(Boolean);
}

/**
 * Shown line `s`'s English cut before word `word`: what comes before stays, ending at line `s`,
 * and the rest starts at the next line, ahead of any English already there.
 */
export function splitEnglish(
	spans: readonly Span[],
	s: number,
	word: number,
	count: number
): Span[] {
	const here = spanAt(spans, s);
	if (here < 0 || s + 1 >= count) return [...spans];
	const span = spans[here];
	const words = wordsOf(span.text);
	if (word <= 0 || word >= words.length) return [...spans];
	const first = { a: span.a, b: s, text: words.slice(0, word).join(' ') };
	const rest = { a: s + 1, b: Math.max(span.b, s + 1), text: words.slice(word).join(' ') };
	return tidySpans([...spans.slice(0, here), first, rest, ...spans.slice(here + 1)]);
}

/**
 * Shown line `s`'s English moved one line earlier or later: alone, or with all English after it.
 * English it lands on is joined to it, in reading order.
 */
export function shiftEnglish(
	spans: readonly Span[],
	s: number,
	by: -1 | 1,
	onward: boolean,
	count: number
): Span[] {
	const here = spanAt(spans, s);
	if (here < 0) return [...spans];
	const clamp = (x: number) => Math.min(count - 1, Math.max(0, x));
	const moves = (i: number) => i === here || (onward && i > here);
	const moved = spans.map((span, i) =>
		moves(i)
			? { a: clamp(span.a + by), b: clamp(span.b + by), text: span.text, moved: true }
			: { ...span, moved: false }
	);
	// On a tie, the English that was earlier stays earlier: moved later, it came first.
	const tie = (x: { moved: boolean }) => (x.moved === (by === 1) ? -1 : 1);
	moved.sort((x, y) => x.a - y.a || (x.moved === y.moved ? 0 : tie(x)));
	return tidySpans(moved.map(({ a, b, text }) => ({ a, b, text })));
}

// --- The Chinese, cut and timed ---

/** Shown line `s` and the one before or after it shown as one. */
export function joinChinese(
	layout: Layout,
	shown: readonly Shown[],
	s: number,
	way: -1 | 1
): Layout {
	const gone = way === 1 ? shown[s + 1]?.from : s > 0 ? shown[s].from : undefined;
	if (!gone) return layout;
	return tidy(
		gone.at === 0
			? { ...layout, joined: [...layout.joined, gone.line] }
			: { ...layout, cuts: layout.cuts.filter((cut) => !same(cut, gone)) }
	);
}

/** A new shown line starting at `pos`. */
export function cutChinese(layout: Layout, pos: Pos): Layout {
	return tidy(
		pos.at === 0
			? { ...layout, joined: layout.joined.filter((line) => line !== pos.line) }
			: { ...layout, cuts: [...layout.cuts, pos] }
	);
}

/** Shown line `s`, or every line, `ms` later. */
export function shiftTime(
	layout: Layout,
	shown: readonly Shown[],
	s: number,
	ms: number,
	all: boolean
): Layout {
	if (all) return { ...layout, offsetMs: layout.offsetMs + ms };
	const at = shown[s].from;
	const now = layout.shifts.find((x) => same(x.at, at))?.ms ?? 0;
	return tidy({
		...layout,
		shifts: [...layout.shifts.filter((x) => !same(x.at, at)), { at, ms: now + ms }]
	});
}

/** The shift of shown line `s` alone, in ms. */
export function shiftOf(layout: Layout, shown: readonly Shown[], s: number): number {
	return layout.shifts.find((x) => same(x.at, shown[s].from))?.ms ?? 0;
}

function tidy(layout: Layout): Layout {
	const cuts = layout.cuts
		.filter((cut, i) => cut.at > 0 && layout.cuts.findIndex((other) => same(other, cut)) === i)
		.sort((x, y) => (before(x, y) ? -1 : 1));
	return {
		...layout,
		joined: [...new Set(layout.joined)].filter((line) => line > 0).sort((a, b) => a - b),
		cuts,
		shifts: layout.shifts.filter((x) => x.ms !== 0)
	};
}
