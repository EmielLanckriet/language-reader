/**
 * Where the audio is cut for the speech model, and which part of each cut is kept (research R3).
 *
 * SenseVoice is built for at most 30 s of audio; longer windows dropped phrases on the street
 * interview, and cutting at pauses either skipped quiet voices or found no pauses. So: fixed
 * windows overlapping by 2 s, each keeping its tokens from the middle of one overlap to the middle
 * of the next, which keeps a word cut at a boundary whole.
 *
 * 10 s long, not 30 (issue #30): under music and sound effects a long window drops whole phrases.
 * Measured 2026-10-08 against human subtitles over 10 minutes each: a cartoon film 44% of its
 * characters right at 30 s, 57% at 20, 74% at 15, 81% at 10; a talking vlog 99% at every length.
 * About a fifth more compute than 30 s on the laptop (scripts/measure/sensevoice/cer.py).
 */

/** A recognised token and its time in the whole recording, in seconds. */
export type Token = [text: string, time: number];

export interface Window {
	start: number;
	end: number;
	/** The tokens this window contributes lie in [keepFrom, keepTo). */
	keepFrom: number;
	keepTo: number;
}

export interface WindowSettings {
	first: number;
	length: number;
	overlap: number;
}

export const WINDOWS: WindowSettings = { first: 10, length: 10, overlap: 2 };

export function windowPlan(duration: number, settings: WindowSettings = WINDOWS): Window[] {
	const { first, length, overlap } = settings;
	const plan: Window[] = [];
	for (let start = 0, size = first; ; start += size - overlap, size = length) {
		const end = Math.min(start + size, duration);
		const last = end >= duration;
		plan.push({
			start,
			end,
			keepFrom: start ? start + overlap / 2 : 0,
			// The whole duration rather than Infinity, so the plan survives JSON.
			keepTo: last ? duration : end - overlap / 2
		});
		if (last) return plan;
	}
}

/** The tokens window `index` of `plan` contributes. */
export function keep(plan: Window[], index: number, tokens: Token[]): Token[] {
	const { keepFrom, keepTo } = plan[index];
	const last = index === plan.length - 1;
	return tokens.filter(([, t]) => t >= keepFrom && (t < keepTo || (last && t <= keepTo)));
}
