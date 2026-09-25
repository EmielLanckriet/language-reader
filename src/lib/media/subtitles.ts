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
