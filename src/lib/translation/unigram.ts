/**
 * opus-mt-zh-en's tokenizer: a SentencePiece Unigram model over one vocabulary shared by Chinese
 * and English, read from the model's tokenizer.json (ADR-0023).
 *
 * Encoding picks the split of each word whose pieces have the highest total log-probability
 * (Viterbi). There is no normalisation step: this model's tokenizer.json has none.
 */

/** Marks the start of a word inside a piece; decoding turns it back into a space. */
const WORD_START = '▁';

export interface Vocabulary {
	pieces: string[];
	scores: Float64Array;
	ids: Map<string, number>;
	/** The longest piece, in code points: how far ahead the search has to look. */
	longest: number;
	unknown: number;
	/** What crossing a character no piece covers costs: more than any real piece. */
	unknownScore: number;
	/** Ids that are never text: `</s>`, `<unk>`, `<pad>`. */
	special: Set<number>;
}

interface TokenizerJson {
	model: { type: string; vocab: [string, number][]; unk_id: number };
	added_tokens: { id: number; content: string }[];
}

export function parseVocabulary(json: TokenizerJson): Vocabulary {
	if (json.model.type !== 'Unigram')
		throw new Error(`Expected a Unigram model, got ${json.model.type}.`);
	const special = new Set(json.added_tokens.map((token) => token.id));
	const pieces = json.model.vocab.map(([piece]) => piece);
	const scores = Float64Array.from(json.model.vocab, ([, score]) => score);
	const ids = new Map<string, number>();
	let longest = 1;
	pieces.forEach((piece, id) => {
		if (special.has(id)) return;
		ids.set(piece, id);
		longest = Math.max(longest, [...piece].length);
	});
	const lowest = scores.reduce((low, score) => Math.min(low, score), 0);
	return {
		pieces,
		scores,
		ids,
		longest,
		unknown: json.model.unk_id,
		unknownScore: lowest - 10,
		special
	};
}

/** Token ids for `text`, without the end-of-sentence id the model expects after them. */
export function encode(text: string, vocabulary: Vocabulary): number[] {
	const ids: number[] = [];
	for (const word of text.split(/\s+/).filter(Boolean)) ids.push(...encodeWord(word, vocabulary));
	return ids;
}

function encodeWord(word: string, vocabulary: Vocabulary): number[] {
	const { ids, scores, longest, unknown, unknownScore } = vocabulary;
	const characters = [...(WORD_START + word)];
	const n = characters.length;

	const best = new Float64Array(n + 1).fill(-Infinity);
	const from = new Int32Array(n + 1);
	const via = new Int32Array(n + 1);
	best[0] = 0;
	for (let start = 0; start < n; start++) {
		if (best[start] === -Infinity) continue;
		let coveredOne = false;
		for (let length = 1; length <= longest && start + length <= n; length++) {
			const id = ids.get(characters.slice(start, start + length).join(''));
			if (id === undefined) continue;
			if (length === 1) coveredOne = true;
			const score = best[start] + scores[id];
			if (score > best[start + length]) {
				best[start + length] = score;
				from[start + length] = start;
				via[start + length] = id;
			}
		}
		if (!coveredOne && best[start] + unknownScore > best[start + 1]) {
			best[start + 1] = best[start] + unknownScore;
			from[start + 1] = start;
			via[start + 1] = unknown;
		}
	}

	const reversed: number[] = [];
	for (let end = n; end > 0; end = from[end]) {
		// Neighbouring unknown characters become one unknown token, as SentencePiece does.
		if (via[end] === unknown && reversed.at(-1) === unknown) continue;
		reversed.push(via[end]);
	}
	return reversed.reverse();
}

/** The English for generated ids, tidied the way the model's own tokenizer tidies it. */
export function decode(ids: number[], vocabulary: Vocabulary): string {
	const text = ids
		.filter((id) => !vocabulary.special.has(id))
		.map((id) => vocabulary.pieces[id])
		.join('')
		.replaceAll(WORD_START, ' ')
		.trim();
	return text
		.replace(/ ([.?!,])/g, '$1')
		.replace(/ ' /g, "'")
		.replace(/ (n't|'m|'s|'ve|'re)\b/g, '$1');
}
