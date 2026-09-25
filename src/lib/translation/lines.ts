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
