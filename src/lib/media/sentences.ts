/**
 * Lines the reader joined into one sentence: subtitles that cut a sentence wherever a line ran out of
 * room are put back together by hand, and taken apart again at their own line breaks. Kept beside
 * the video (`sentences.json`) as the joined runs; every other line stands alone.
 */

/** A run of lines shown as one, [first, last], inclusive. */
export type Run = [number, number];

export const SENTENCES = 'sentences.json';

/** Every line in order, each in exactly one run: the joined runs, and single lines between them. */
export function runsOf(count: number, joined: readonly Run[]): Run[] {
	const starts = new Map(
		joined.filter(([a, b]) => a >= 0 && b > a && b < count).map(([a, b]) => [a, b])
	);
	const runs: Run[] = [];
	for (let i = 0; i < count; i++) {
		const last = starts.get(i) ?? i;
		runs.push([i, last]);
		i = last;
	}
	return runs;
}

/** The joined runs after shown line `shown` is joined with the one after it. */
export function joinWithNext(runs: readonly Run[], shown: number): Run[] {
	const next = runs[shown + 1];
	if (!runs[shown] || !next) return joinedOf(runs);
	const merged = runs.map((run) => [...run] as Run);
	merged.splice(shown, 2, [runs[shown][0], next[1]]);
	return joinedOf(merged);
}

/** The joined runs after shown line `shown` is taken apart into its own lines again. */
export function splitApart(runs: readonly Run[], shown: number): Run[] {
	return joinedOf(runs.filter((_, i) => i !== shown));
}

function joinedOf(runs: readonly Run[]): Run[] {
	return runs.filter(([a, b]) => b > a).map(([a, b]) => [a, b]);
}
