/**
 * Bringing one document's tokens up to date with the analyzer now in use.
 *
 * **There is exactly one implementation, and both paths call it.** Opening a stale document and
 * sweeping one in the background must produce identical tokens (FR-017); sharing the function makes
 * that true by construction rather than by testing two implementations against each other and
 * hoping they stay in step.
 *
 * It lives on this side of the worker boundary because the analyzer does. `analyze` is a function
 * and functions do not survive `structuredClone`, which is the same reason `resolveTokens` sits
 * here rather than in the repository. The worker is handed finished tokens and applies them in one
 * transaction; it holds no opinion about how they were produced.
 */

import type { Analyzer } from '../analyzer/types';
import { resolveTokens, stampOf, type ResolvedToken } from '../analyzer/resolve';
import type { RepositoryClient } from './client';
import type { StoredDocument } from './repository';

export function isStale(document: StoredDocument, analyzer: Analyzer): boolean {
	return document.analyzer !== analyzer.name || document.analyzerVersion !== analyzer.version;
}

/**
 * Whether a document's stored tokens are too poor to put in front of the reader.
 *
 * Distinct from being out of date, and the distinction is what makes dictionary-first import
 * possible. Slice 1 re-derived any stale document before showing it, which was right when
 * re-deriving cost 3.8 ms per 5,000 characters. The shipped analyzer now costs about 4 s per 1,000
 * (research.md R18), so a 5,000-character document took over thirty seconds to open and SC-004
 * failed. Documents are imported with the fast fallback and upgraded by the background sweep
 * instead, which makes "out of date" the ordinary condition of a freshly imported document rather
 * than a fault — and paying thirty seconds to correct a document that already shows real words is
 * not a trade the reader would choose.
 *
 * What may still never be shown is placeholder segmentation (FR-015): slice 0's dummy analyzer
 * emitted one token per character, and so did `Intl.Segmenter` on the reader's own phone.
 *
 * **A property of the tokens, deliberately not a list of analyzer names.** A name cannot tell you
 * what a device produced. That is the whole lesson of research.md R11, where two devices running
 * `intl-segmenter-zh` disagreed completely and the name was identical on both. So the question
 * asked here is the one that matters directly: did anything find a word longer than one character?
 *
 * The Han test keeps the answer honest for a document with no Chinese in it. A page of Latin and
 * digits has no multi-character *word* under any analyzer, and treating that as unsegmented would
 * spend a thirty-second pass to produce exactly the same tokens.
 */
export function looksUnsegmented(document: StoredDocument): boolean {
	if (!/\p{Script=Han}/u.test(document.rawContent)) return false;
	return !document.tokens.some((token) => token.isWord && token.end - token.start > 1);
}

/**
 * Whether opening this document must re-derive it first, rather than showing it and letting the
 * background sweep catch up.
 *
 * Both conditions are needed. A document already stamped by the analyzer in force is never
 * re-derived — `rederiveDocument` is idempotent and asking again would be a wasted pass — and a
 * document showing real words can be shown now and improved later.
 */
export function needsImmediateRederivation(document: StoredDocument, analyzer: Analyzer): boolean {
	return isStale(document, analyzer) && looksUnsegmented(document);
}

/**
 * Segment a document's retained source under the given analyzer, without storing anything.
 *
 * Separated from persisting on purpose. A copy of the application that does not hold storage still
 * has to show the reader real words rather than placeholder ones (FR-015) — it simply cannot write
 * them down. Splitting the two lets the read-only case display correct words and leave the document
 * stale, for a copy that can write to fix later.
 */
export async function tokensFor(
	document: StoredDocument,
	analyzer: Analyzer
): Promise<ResolvedToken[]> {
	const analyzed = await analyzer.analyze(document.rawContent);
	return resolveTokens(document.rawContent, analyzed, analyzer);
}

/**
 * Re-derive a document and store the result.
 *
 * Idempotent: a document already stamped by this analyzer is left alone rather than rewritten, so
 * calling this on every open costs one comparison rather than a transaction.
 *
 * Returns the tokens now in force, so a caller that is about to display the document does not have
 * to read it back.
 */
export async function rederiveDocument(
	client: RepositoryClient,
	document: StoredDocument,
	analyzer: Analyzer
): Promise<ResolvedToken[] | undefined> {
	if (!isStale(document, analyzer)) return undefined;

	const tokens = await tokensFor(document, analyzer);
	await client.replaceTokens(document.id, tokens, stampOf(analyzer));
	return tokens;
}
