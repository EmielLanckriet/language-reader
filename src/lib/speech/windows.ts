/**
 * Where the audio is cut for the speech model, and which part of each cut is kept (research R3).
 *
 * SenseVoice is built for at most 30 s of audio; longer windows dropped phrases on the street
 * interview, and cutting at pauses either skipped quiet voices or found no pauses. So: fixed 30 s
 * windows overlapping by 2 s, each keeping its tokens from the middle of one overlap to the middle
 * of the next, which keeps a word cut at a boundary whole. The first window is shorter so that the
 * first lines arrive sooner (Principle VIII); measured to cost no accuracy.
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

export const WINDOWS: WindowSettings = { first: 10, length: 30, overlap: 2 };

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
