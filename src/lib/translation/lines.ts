/**
 * Which English each line shows, when two translators have been at it (ADR-0023, Principle VIII):
 * the local LLM's line wherever it has one, the quick model's otherwise. A better line is never
 * replaced by a rougher one, and each line says which it is.
 */

export type EnglishSource = 'llm' | 'quick';

export interface English {
	text: string;
	source: EnglishSource;
}

export function englishFor(
	count: number,
	llm: readonly (string | undefined)[],
	quick: readonly (string | null | undefined)[]
): (English | undefined)[] {
	return Array.from({ length: count }, (_, i) => {
		const better = llm[i]?.trim();
		if (better) return { text: better, source: 'llm' };
		const rough = quick[i]?.trim();
		return rough ? { text: rough, source: 'quick' } : undefined;
	});
}

/**
 * The LLM's English for each Chinese line, matched by start time rather than position.
 *
 * translate.py copies each Chinese cue's timing onto its English, and writes no cue for a line it
 * could not place. By position, one missing cue moved every later line's English onto the line
 * before it, measured on the tariff video; by time, it only leaves that line to the quick model.
 */
export function llmByLine(
	chinese: readonly { start: number }[],
	english: readonly { start: number; text: string }[]
): (string | undefined)[] {
	const at = new Map(english.map((cue) => [Math.round(cue.start * 1000), cue.text]));
	return chinese.map((cue) => at.get(Math.round(cue.start * 1000)));
}

/**
 * The lines shown as one, as [first, last] pairs covering every line once, in order: translate.py
 * translates a clause the subtitles cut over several lines as one, and writes one English cue from
 * its first line's start to its last line's end. A line no such cue covers stays on its own.
 */
export function clausesOf(
	chinese: readonly { start: number; end: number }[],
	english: readonly { start: number; end: number }[]
): [number, number][] {
	const ms = (seconds: number) => Math.round(seconds * 1000);
	const ends = new Map(english.map((cue) => [ms(cue.start), ms(cue.end)]));
	const found: [number, number][] = [];
	for (let i = 0; i < chinese.length; i++) {
		const end = ends.get(ms(chinese[i].start));
		let last = i;
		if (end !== undefined)
			while (last + 1 < chinese.length && ms(chinese[last + 1].start) < end) last++;
		found.push([i, last]);
		i = last;
	}
	return found;
}

/** Whether each line has the LLM's English, its own or its clause's: the quick model skips those. */
export function coveredByLlm(
	chinese: readonly { start: number; end: number }[],
	english: readonly { start: number; end: number; text: string }[]
): boolean[] {
	const own = llmByLine(chinese, english);
	const covered = chinese.map(() => false);
	for (const [first, last] of clausesOf(chinese, english))
		if (own[first]?.trim()) for (let i = first; i <= last; i++) covered[i] = true;
	return covered;
}
