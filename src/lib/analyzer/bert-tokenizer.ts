/**
 * Turning Chinese characters into the ids the segmentation model was trained on.
 *
 * For a Chinese BERT this is genuinely simple, which is why it is written here rather than pulled
 * in: the vocabulary is character-level, so tokenizing is one lookup per character plus the two
 * markers the model expects around a sequence. The alternative — Transformers.js — brings a
 * tokenizer framework, a model loader and a pipeline abstraction to do what fits on a page.
 *
 * The one hazard is silent mis-mapping. An id from one vocabulary fed to another model returns
 * confident nonsense rather than an error, so the vocabulary is committed alongside its content
 * hash and both are part of the analyzer's version.
 */

export function parseVocabulary(text: string): Map<string, number> {
	const vocabulary = new Map<string, number>();
	const lines = text.split('\n');
	for (let id = 0; id < lines.length; id++) {
		if (lines[id] === '' && id === lines.length - 1) continue; // trailing newline
		// First occurrence wins, matching how the model's own tokenizer reads this file.
		if (!vocabulary.has(lines[id])) vocabulary.set(lines[id], id);
	}
	return vocabulary;
}

export interface Encoded {
	inputIds: BigInt64Array;
	attentionMask: bigint[];
	tokenTypeIds: bigint[];
}

/**
 * Encode one run of characters, with `[CLS]` before and `[SEP]` after.
 *
 * Every character produces exactly one id, including characters absent from the vocabulary, which
 * become `[UNK]`. That matters more than it looks: dropping an unknown character would shift every
 * tag after it onto the wrong character, which is the offset-corruption failure wearing a different
 * costume.
 */
export function encodeCharacters(
	characters: readonly string[],
	vocabulary: Map<string, number>
): Encoded {
	const unknown = vocabulary.get('[UNK]') ?? 100;
	const ids = [
		vocabulary.get('[CLS]') ?? 101,
		...characters.map((character) => vocabulary.get(character) ?? unknown),
		vocabulary.get('[SEP]') ?? 102
	];

	return {
		inputIds: BigInt64Array.from(ids.map((id) => BigInt(id))),
		attentionMask: ids.map(() => 1n),
		tokenTypeIds: ids.map(() => 0n)
	};
}
