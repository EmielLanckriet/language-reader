/**
 * Which English each line shows (ADR-0023, Principle VIII): a person's line from a downloaded
 * English track (spec 012) wherever it has one, then the local LLM's, then the quick model's. A
 * better line is never replaced by a rougher one, and each line says which it is.
 */

export type EnglishSource = 'human' | 'llm' | 'quick' | 'edited';

export interface English {
	text: string;
	source: EnglishSource;
	/** The next line shows this same sentence (sentenceRuns); shown once where all English is. */
	continues?: true;
}

export function englishFor(
	count: number,
	llm: readonly (string | undefined)[],
	quick: readonly (string | null | undefined)[],
	human: readonly (string | Run | undefined)[] = []
): (English | undefined)[] {
	return Array.from({ length: count }, (_, i) => {
		const person = human[i];
		const best = (typeof person === 'string' ? person : person?.text)?.trim();
		if (best)
			return typeof person === 'object' && person.continues
				? { text: best, source: 'human', continues: true }
				: { text: best, source: 'human' };
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
 * A human English track's lines under the Chinese lines (spec 012, research R3). Each English cue
 * goes under the one Chinese line it overlaps most (the nearest, if it overlaps none), so every
 * English line is shown exactly once, in order; a Chinese line no cue chose stays undefined, for
 * the translators to fill. Identically timed tracks, the usual case, map one to one.
 */
export function humanByLine(
	chinese: readonly { start: number; end: number }[],
	english: readonly { start: number; end: number; text: string }[]
): (string | undefined)[] {
	const lines: string[][] = chinese.map(() => []);
	if (chinese.length === 0) return [];
	for (const cue of english) {
		let best = 0;
		let score = -Infinity;
		chinese.forEach((line, i) => {
			const overlap = Math.min(line.end, cue.end) - Math.max(line.start, cue.start);
			// Overlap counts first; without any, closeness (a negative distance) decides.
			if (overlap > score) {
				score = overlap;
				best = i;
			}
		});
		// A translator's repeat of a line, when both copies land here, is shown once.
		if (lines[best].at(-1) !== cue.text) lines[best].push(cue.text);
	}
	return lines.map((texts) => (texts.length > 0 ? texts.join(' ') : undefined));
}

/** A human line's English as shown: its whole sentence, and whether the next line shows it too. */
export interface Run {
	text: string;
	continues: boolean;
}

const ENDS_SENTENCE = /[.!?…]["”’)\]]*$/;
const GOES_ON = /^[\p{Ll},.;:!?…)]/u;
const ATTACHES = /^[,.;:!?…)]/;
/** However a track runs on, a sentence spans at most this many Chinese lines. */
const LONGEST_RUN = 12;

/**
 * Some channels' English tracks are a sentence-by-sentence translation cut across the Chinese
 * cues: ", and it seemed", "Foreign" · "women" · "might" (非诚勿扰, 2026-11-07). A line's English
 * joins the next line's when it ends no sentence and the next one goes on with a lower-case word
 * or punctuation, so every line of the run shows the whole sentence. A track whose lines each hold
 * a sentence, or that has no punctuation at all, starts every line anew and stays as it is.
 */
export function sentenceRuns(lines: readonly (string | undefined)[]): (Run | undefined)[] {
	const runs: (Run | undefined)[] = lines.map(() => undefined);
	const text = (i: number) => lines[i]?.trim() ?? '';
	let start = 0;
	while (start < lines.length) {
		if (!text(start)) {
			start++;
			continue;
		}
		let end = start;
		let joined = text(start);
		while (
			end + 1 < lines.length &&
			end + 1 - start < LONGEST_RUN &&
			text(end + 1) &&
			!ENDS_SENTENCE.test(text(end)) &&
			GOES_ON.test(text(end + 1))
		) {
			end++;
			joined += (ATTACHES.test(text(end)) ? '' : ' ') + text(end);
		}
		for (let i = start; i <= end; i++) runs[i] = { text: joined, continues: i < end };
		start = end + 1;
	}
	return runs;
}
