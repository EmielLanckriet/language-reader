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
