/**
 * SEAM: content sources (Constitution Principle V, seam 2).
 *
 * Pasted text today; EPUB, subtitles and YouTube transcripts are all rated likely in
 * docs/anticipated-changes.md. Each becomes one implementation of this interface.
 *
 * Slice 0 supplies only one implementation, so this boundary is *asserted* rather than
 * demonstrated — recorded honestly rather than glossed. It is justified by the register, not by
 * the single instance present here.
 *
 * See specs/001-reader-walking-skeleton/contracts/content-source.md.
 */

export interface IngestedDocument {
	/**
	 * Verbatim. No trimming, no whitespace collapsing, no newline rewriting.
	 *
	 * This is the retained input everything else is derived from (FR-002, ADR-0003's
	 * preserve-the-inputs corollary). A source that quietly edits it converts derived data into
	 * earned data without saying so — the tokens could no longer be rebuilt from what was stored.
	 */
	rawContent: string;

	/**
	 * Declared now, not inferred later (FR-002). `text/plain` here; storing HTML later must not
	 * require touching existing rows, which is the whole reason this column exists.
	 */
	contentType: string;

	language: string;

	/** Derived from the content, and freely recomputable. Not earned. */
	title: string;
}

/** Raised when input is refused. Carries a reason the reader can act on (FR-018). */
export class RejectedInput extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'RejectedInput';
	}
}

export interface ContentSource {
	readonly kind: string;

	/**
	 * Turn some input into a document, or refuse it.
	 *
	 * Validation happens before construction, so a rejected import leaves nothing behind (FR-018,
	 * FR-020). Sources never store anything: that is the repository's job.
	 */
	ingest(input: unknown): Promise<IngestedDocument>;
}
