/**
 * The rule every analyzer must obey: its tokens tile the document exactly (FR-005).
 *
 * Ordered, non-overlapping, gapless, and reassembling to the source content — which is the one
 * thing that is true of *every* analyzer, present and future. Where the cuts fall is an opinion
 * about word-hood, and opinions differ; that the cuts partition the text is not.
 *
 * This lives in the domain rather than inside a test because the repository checks it too: an
 * analyzer that violates it would silently store tokens that no longer reassemble to the document,
 * and tokens are how the reader sees the text at all.
 */

import { codePointLength } from './offsets';

/** Anything positioned in a document. Both `Token` and the analyzer's `AnalyzedToken` fit. */
export interface Span {
	start: number;
	end: number;
}

/**
 * Everything wrong with a tiling, described so a reader can act on it.
 *
 * A list rather than a boolean, and a throw only at the call sites that want one: when this fires
 * during development it is nearly always a new analyzer's off-by-one, and "expected 0 but got 1"
 * would waste the information already in hand.
 */
export function checkTiling(spans: readonly Span[], text: string): string[] {
	const problems: string[] = [];
	const length = codePointLength(text);

	if (spans.length === 0) {
		if (length > 0) problems.push(`no tokens, but the text is ${length} characters long`);
		return problems;
	}

	if (spans[0].start !== 0) {
		problems.push(`first token starts at ${spans[0].start}, not at 0`);
	}

	for (const [index, span] of spans.entries()) {
		if (span.end <= span.start) {
			problems.push(`token ${index} is empty or inverted: [${span.start}, ${span.end})`);
		}
		if (span.start < 0 || span.end > length) {
			problems.push(`token ${index} lies outside the text: [${span.start}, ${span.end})`);
		}
		if (index > 0) {
			const previous = spans[index - 1];
			if (span.start < previous.end) {
				problems.push(
					`token ${index} overlaps or precedes token ${index - 1}: ` +
						`[${previous.start}, ${previous.end}) then [${span.start}, ${span.end})`
				);
			} else if (span.start > previous.end) {
				problems.push(`gap between token ${index - 1} and token ${index}`);
			}
		}
	}

	const last = spans[spans.length - 1];
	if (last.end !== length) {
		problems.push(`last token ends at ${last.end}, but the text is ${length} characters long`);
	}

	return problems;
}

/** Whether the spans tile the text. Use `checkTiling` when you want to know what went wrong. */
export function tiles(spans: readonly Span[], text: string): boolean {
	return checkTiling(spans, text).length === 0;
}
