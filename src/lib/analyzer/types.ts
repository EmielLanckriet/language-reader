/**
 * SEAM: language providers (Constitution Principle V, seam 1).
 *
 * Chinese needs segmentation and pronunciation; Dutch needs lemmatisation and compound splitting.
 * Everything language-specific sits behind this interface, so the rest of the application never
 * learns which language it is displaying.
 *
 * See specs/001-reader-walking-skeleton/contracts/analyzer.md for the obligations every
 * implementation carries.
 */

/**
 * One token, as an analyzer reports it. No lexeme yet: deciding *which occurrences are the same
 * word* is a separate step the repository performs using the provider's identity rule (FR-009).
 */
export interface AnalyzedToken {
	start: number; // code-point offset into the analysed text, inclusive
	end: number; // code-point offset, exclusive
	isWord: boolean; // false for punctuation, whitespace and Latin runs
}

export interface Analyzer {
	/** Recorded on every document this analyzer produces tokens for (FR-003). */
	readonly name: string;

	/**
	 * With `name`, identifies what produced a document's tokens — which is what makes replacing
	 * this analyzer a deliberate recompute rather than an untraceable change.
	 */
	readonly version: string;

	readonly language: string;

	/**
	 * Characters this language can never have inside a word (slice 2, ADR-0013).
	 *
	 * Text is split on these before analysis, so no token can span one. The admission rule is
	 * language-neutral and strict: include a character only if it *cannot* occur inside a word in
	 * this language. Where that is unclear, leave it out — the risk is asymmetric. A missed boundary
	 * only widens the stretch of context the segmenter sees and is harmless; a false boundary can
	 * split a real word.
	 *
	 * The set lives here, on the provider, because what can appear inside a word is a fact about a
	 * language rather than about segmentation. Chinese excludes the ASCII full stop, which there
	 * sits inside numbers, abbreviations and URLs. Dutch will depend on it as the sentence
	 * terminator, where telling it from an abbreviation is a genuinely hard problem — one that
	 * arrives with Dutch, and that a shared set would have hidden until then.
	 */
	readonly unitDelimiters: ReadonlySet<string>;

	/**
	 * Split text into tokens that tile it exactly.
	 *
	 * Asynchronous even though slice 0's implementation is instant and pure. This is the one piece
	 * of shape in this slice not justified by slice-0 need, and it is deliberate: a small ONNX
	 * sequence tagger must load a model, an LLM analyzer makes a network call that can fail
	 * part-way, and an ensemble runs several sources and reconciles them. A synchronous interface
	 * fits none of those, and widening it later means changing every call site — cheap in effort,
	 * but the kind of change that gets deferred and then quietly constrains what gets built.
	 */
	analyze(text: string): Promise<AnalyzedToken[]>;

	/**
	 * The rule deciding which occurrences count as the same word (FR-009).
	 *
	 * Given a token's written form, return the key under which its marks accumulate. The storage
	 * layer applies whatever this returns and holds no opinion of its own — which is what lets the
	 * rule change without a migration, because marks are keyed on a surrogate id rather than on
	 * this string (ADR-0002).
	 *
	 * Chinese in slice 0 returns the surface form unchanged, so 看看 and 看 are different words and
	 * the two readings of 行 are the same one. Dutch will return a dictionary form instead, and
	 * splitting heteronyms will return something finer. Both are changes to this function alone.
	 */
	lexemeKey(surface: string): string;
}
