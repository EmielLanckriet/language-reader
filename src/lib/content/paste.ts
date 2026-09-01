/**
 * Slice 0's only content source: text the reader pasted in.
 */

import { type ContentSource, type IngestedDocument, RejectedInput } from './types';
import { codePointLength, sliceByCodePoints } from '../domain/offsets';

/**
 * The largest document this slice accepts (FR-020).
 *
 * Exact rather than approximate, so the boundary is testable, and counted in characters for the
 * same reason every other position in this application is. Slice 0 renders a document in full and
 * does not paginate, so a full chapter is out of scope rather than slow. Raising this later is a
 * presentation change over derived data and touches nothing stored.
 */
export const MAXIMUM_CHARACTERS = 5000;

/** How much of the opening text becomes the document's title. */
const TITLE_CHARACTERS = 30;

export const pasteSource: ContentSource = {
	kind: 'paste',

	ingest(input: unknown): Promise<IngestedDocument> {
		if (typeof input !== 'string') {
			return Promise.reject(new RejectedInput('Pasted content must be text.'));
		}

		// Emptiness is judged on the trimmed text, but what gets *stored* is the original. The
		// reader's paragraph breaks and indentation are part of the document (FR-002).
		if (input.trim() === '') {
			return Promise.reject(new RejectedInput('There is nothing to save — paste some text first.'));
		}

		const length = codePointLength(input);
		if (length > MAXIMUM_CHARACTERS) {
			return Promise.reject(
				new RejectedInput(
					`That text is ${length.toLocaleString()} characters. ` +
						`This version accepts up to ${MAXIMUM_CHARACTERS.toLocaleString()}. ` +
						`Try saving it in smaller pieces.`
				)
			);
		}

		return Promise.resolve({
			rawContent: input,
			contentType: 'text/plain',
			language: 'zh',
			title: titleFrom(input)
		});
	}
};

/**
 * A title from the opening characters. Derived data — recompute it freely, and never treat a
 * reader's edit of it as something to preserve, because nothing edits it yet.
 */
function titleFrom(text: string): string {
	const firstLine = text.trim().split('\n')[0].trim();
	if (codePointLength(firstLine) <= TITLE_CHARACTERS) return firstLine;
	return sliceByCodePoints(firstLine, 0, TITLE_CHARACTERS) + '…';
}
