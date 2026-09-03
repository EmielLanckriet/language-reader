/**
 * Chinese sentence-final punctuation and line breaks (ADR-0013).
 *
 * Each of these can never appear inside a Chinese word, which is the whole admission rule. The
 * ASCII full stop is deliberately absent: in Chinese text it belongs to 3.14, to U.S., and to
 * example.com rather than to the end of a sentence, so admitting it would split a decimal in half.
 * That exclusion is a fact about Chinese and must not be copied to a language that ends sentences
 * with it.
 *
 * Lives in its own module because two analyzers now share it, and a set duplicated between them is
 * a set that can drift.
 */
export const CHINESE_UNIT_DELIMITERS: ReadonlySet<string> = new Set([
	'\n',
	'\r',
	'。',
	'！',
	'？',
	'…',
	'；'
]);
