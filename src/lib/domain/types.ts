/**
 * The vocabulary the domain core speaks. Plain data, no behaviour, no imports.
 *
 * Nothing here knows that SQLite or Svelte exist, which is Constitution Principle V.4 and is
 * enforced by tests/architecture/domain-purity.test.ts rather than by intention.
 */

/**
 * Identifiers are surrogates — meaningless numbers, never the written form of anything.
 *
 * This is ADR-0002's central move. Word identity in Chinese is genuinely unsettled (是 看看 一个 北大
 * all raise different questions), and Dutch will want dictionary form rather than surface form.
 * Keying marks on a number means the rule deciding *which occurrences are the same word* can
 * change without rewriting a single accumulated mark.
 */
export type LexemeId = number;
export type DocumentId = number;
export type UserId = number;
export type DeviceId = string;

/**
 * A word, as this application currently understands the term.
 *
 * `surface` is an *attribute* of the lexeme, never its identity — see LexemeId above.
 */
export interface Lexeme {
	id: LexemeId;
	language: string;
	surface: string;
}

/**
 * One occurrence of something at a position in a document. Derived data: discardable, and
 * rebuildable from the document's retained raw content by re-running its analyzer.
 *
 * A single contiguous span, in slice 0. Discontiguous words — 帮忙 split by an object, Dutch
 * separable verbs — are a recompute later rather than a migration, because tokens are derived.
 */
export interface Token {
	start: number; // code-point offset into raw content, inclusive
	end: number; // code-point offset, exclusive
	isWord: boolean; // punctuation, whitespace and Latin runs are tiled but not markable
	lexemeId?: LexemeId; // absent exactly when isWord is false
}

/**
 * How a judgment was acquired (FR-012).
 *
 * Deliberately a string rather than a union: import from Anki, import from a word list, and
 * inference from reading behaviour are all foreseen, and each should be addable without a
 * migration. `MANUAL` is the only value slice 0 writes.
 */
export type Provenance = string;
export const MANUAL: Provenance = 'manual';

/**
 * The reader's current judgment of one word — a **projection** over the history, not an
 * independent fact (FR-010a). A row exists only where a judgment was actually made: absence
 * means never judged, which is distinct from any state the reader can choose (FR-006b).
 */
export interface WordState {
	lexemeId: LexemeId;
	state: string; // free text, not an enum — nothing may depend on there being four (FR-006a)
	provenance: Provenance;
	userId: UserId;
}

/**
 * What the reader was looking at when they made a judgment.
 *
 * Optional, and mostly unfilled in slice 0. It is retained because same-reading homographs — 花
 * as *flower* and as *to spend* — are told apart by context and by nothing else, so a future sense
 * discriminator needs the evidence to have been recorded at the time. No fold recovers it later.
 */
export interface Occurrence {
	documentId: DocumentId;
	fromOffset: number;
	toOffset: number;
	observedPronunciation?: string;
}

/**
 * One entry in the permanent history (FR-010). Append-only: never updated, never deleted.
 *
 * It records **what the reader asserted**, not what the state became. The difference matters
 * because current state will later depend on signals the reader does not supply directly — how
 * often a word was encountered, whether its meaning was looked up — at which point a stored
 * conclusion would be a superseded fold frozen into the log.
 */
export interface HistoryEntry {
	lexemeId: LexemeId;
	asserted: string;
	assertedAt: string; // device wall-clock, ISO-8601: for display, not for ordering
	deviceId: DeviceId;
	deviceSeq: number; // what actually orders the log — immune to clock drift and time zones
	provenance: Provenance;
	userId: UserId;
	occurrence?: Occurrence;
}
