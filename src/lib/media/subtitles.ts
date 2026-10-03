/** Parsing WebVTT (and SRT, which differs only in its comma decimals and missing header). */

export interface Cue {
	start: number;
	end: number;
	text: string;
}

const TIMING = /(\d+:)?(\d{1,2}):(\d{2})[.,](\d{3})\s+-->\s+(\d+:)?(\d{1,2}):(\d{2})[.,](\d{3})/;

function seconds(h: string | undefined, m: string, s: string, ms: string): number {
	return (h ? parseInt(h) * 3600 : 0) + parseInt(m) * 60 + parseInt(s) + parseInt(ms) / 1000;
}

/** Simplified before traditional by yt-dlp's language suffix; lower is preferred. */
function namePreference(name: string): number {
	if (/zh-(CN|Hans|SG)\b/i.test(name)) return 0;
	if (/\.zh\./i.test(name)) return 1;
	return 2;
}

/** Each cue's lines without markup, for telling what kind of track this is. */
function cueLines(source: string): string[][] {
	const cues: string[][] = [];
	for (const block of source.replace(/\r/g, '').split(/\n{2,}/)) {
		const lines = block.split('\n');
		const at = lines.findIndex((line) => TIMING.test(line));
		if (at === -1) continue;
		const text = lines
			.slice(at + 1)
			.map((line) => line.replace(/<[^>]*>/g, '').trim())
			.filter(Boolean);
		if (text.length > 0) cues.push(text);
	}
	return cues;
}

const han = (line: string) => /\p{Script=Han}/u.test(line);

/**
 * The share of cues that carry a line without any Chinese beside a Chinese line: a learner track
 * with pinyin or English under each line. Track names do not say so (Jun's pinyin track is plain
 * "Chinese (Simplified)"), and a few Latin words inside a Chinese line do not count.
 */
function mixedShare(source: string): number {
	const cues = cueLines(source);
	const mixed = cues.filter(
		(text) => text.some(han) && text.some((line) => !han(line) && /\p{L}{2}/u.test(line))
	).length;
	return cues.length === 0 ? 0 : mixed / cues.length;
}

/** A downloaded subtitle track, as tracks.json describes it (spec 012), with its text. */
export interface SubtitleTrack {
	file: string;
	lang: string;
	name: string;
	kind: 'human' | 'automatic';
	text: string;
}

export interface ClassifiedTrack extends SubtitleTrack {
	/** Most cues have a Chinese line. */
	chinese: boolean;
	/** Chinese with a pinyin or English line under most lines. */
	mixed: boolean;
	/** An English-language track without Chinese lines. */
	english: boolean;
	/** The better-ranked Chinese track with exactly the same lines, when this is a copy of it. */
	duplicateOf?: string;
}

/** Clean before mixed, human before automatic, then simplified before traditional. */
function rank(a: ClassifiedTrack, b: ClassifiedTrack): number {
	return (
		Number(a.mixed) - Number(b.mixed) ||
		Number(a.kind !== 'human') - Number(b.kind !== 'human') ||
		namePreference(a.file) - namePreference(b.file)
	);
}

/** Chinese tracks first in the order they are preferred, then the rest as given. */
export function classifyTracks(tracks: SubtitleTrack[]): ClassifiedTrack[] {
	const classified = tracks.map((track) => {
		const cues = cueLines(track.text);
		// Japanese is written largely in Chinese characters: the language code has to agree.
		const chinese =
			(track.lang === '' || /^zh\b/i.test(track.lang)) &&
			cues.length > 0 &&
			cues.filter((text) => text.some(han)).length / cues.length > 0.5;
		return {
			...track,
			chinese,
			mixed: chinese && mixedShare(track.text) > 0.3,
			// English-coded learner tracks often carry Chinese and pinyin too: those are not English.
			english:
				/^en\b/i.test(track.lang) && cues.filter((text) => text.some(han)).length <= cues.length / 2
		};
	});
	const chinese = classified.filter((track) => track.chinese).sort(rank);
	const seen = new Map<string, string>();
	const result: ClassifiedTrack[] = chinese.map((track) => {
		const lines = parseSubtitles(track.text)
			.map((cue) => cue.text)
			.join('\n');
		const original = seen.get(lines);
		if (original) return { ...track, duplicateOf: original };
		seen.set(lines, track.file);
		return track;
	});
	return [...result, ...classified.filter((track) => !track.chinese)];
}

function humanEnglish(tracks: ClassifiedTrack[]): ClassifiedTrack[] {
	return tracks
		.filter((track) => track.english && track.kind === 'human')
		.sort((a, b) => Number(a.lang !== 'en') - Number(b.lang !== 'en'));
}

/** What import uses unless the reader chooses otherwise. */
export function defaultChoice(tracks: ClassifiedTrack[]): {
	chinese: string | undefined;
	english: string;
} {
	return {
		chinese: tracks.find((track) => track.chinese)?.file,
		english: humanEnglish(tracks)[0]?.file ?? 'machine'
	};
}

/**
 * Whether import asks (spec 012, clarified): two or more different clean human Chinese tracks, or
 * any human English track. Mixed tracks and copies beside one clean track never cause a question.
 */
export function choiceNeeded(tracks: ClassifiedTrack[]): boolean {
	const clean = tracks.filter(
		(track) => track.chinese && !track.mixed && track.kind === 'human' && !track.duplicateOf
	);
	return clean.length >= 2 || humanEnglish(tracks).length > 0;
}

/**
 * One cue per timed block, its text on one line.
 *
 * YouTube's automatic captions repeat each line in the next cue as they roll up, so a line equal to
 * the one before it is dropped, unless `keepRepeats`: a human translator repeats a line on purpose,
 * under each of the cues it covers. The line index is what ties the text to its time: line i of the
 * document is cue i, which is why a cue's text must never contain a newline.
 */
export function parseSubtitles(source: string, { keepRepeats = false } = {}): Cue[] {
	const cues: Cue[] = [];
	let previous = '';
	for (const block of source.replace(/\r/g, '').split(/\n{2,}/)) {
		const lines = block.split('\n');
		const at = lines.findIndex((line) => TIMING.test(line));
		if (at === -1) continue;
		const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = TIMING.exec(lines[at])!;
		const fresh = lines
			.slice(at + 1)
			.map((line) => line.replace(/<[^>]*>/g, '').trim())
			// Across cues a repeat may be deliberate; inside one cue a doubled line never is.
			.filter((line, i, all) => line && line !== all[i - 1] && (keepRepeats || line !== previous));
		if (fresh.length === 0) continue;
		previous = fresh[fresh.length - 1];
		cues.push({
			start: seconds(h1?.slice(0, -1), m1, s1, ms1),
			end: seconds(h2?.slice(0, -1), m2, s2, ms2),
			text: fresh.join(' ')
		});
	}
	return cues;
}
