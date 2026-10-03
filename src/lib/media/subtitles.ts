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

/**
 * One cue per timed block, its text on one line.
 *
 * YouTube's automatic captions repeat each line in the next cue as they roll up, so a line equal to
 * the one before it is dropped. The line index is what ties the text to its time: line i of the
 * document is cue i, which is why a cue's text must never contain a newline.
 */
/** Simplified before traditional by yt-dlp's language suffix; lower is preferred. */
function namePreference(name: string): number {
	if (/zh-(CN|Hans|SG)\b/i.test(name)) return 0;
	if (/\.zh\./i.test(name)) return 1;
	return 2;
}

/**
 * The share of cues that carry a line without any Chinese beside a Chinese line: a learner track
 * with pinyin or English under each line. Track names do not say so (Jun's pinyin track is plain
 * "Chinese (Simplified)"), and a few Latin words inside a Chinese line do not count.
 */
function mixedShare(source: string): number {
	let cues = 0;
	let mixed = 0;
	for (const block of source.replace(/\r/g, '').split(/\n{2,}/)) {
		const lines = block.split('\n');
		const at = lines.findIndex((line) => TIMING.test(line));
		if (at === -1) continue;
		const text = lines
			.slice(at + 1)
			.map((line) => line.replace(/<[^>]*>/g, '').trim())
			.filter(Boolean);
		if (text.length === 0) continue;
		cues++;
		const han = (line: string) => /\p{Script=Han}/u.test(line);
		if (text.some(han) && text.some((line) => !han(line) && /\p{L}{2}/u.test(line))) mixed++;
	}
	return cues === 0 ? 0 : mixed / cues;
}

/** The track to read: a clean one when there is one, then simplified before traditional. */
export function chooseChineseTrack<T extends { name: string; text: string }>(
	tracks: T[]
): T | undefined {
	const ranked = tracks.map((track) => ({ track, mixed: mixedShare(track.text) > 0.3 ? 1 : 0 }));
	ranked.sort(
		(a, b) => a.mixed - b.mixed || namePreference(a.track.name) - namePreference(b.track.name)
	);
	return ranked[0]?.track;
}

export function parseSubtitles(source: string): Cue[] {
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
			.filter((line) => line && line !== previous);
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
