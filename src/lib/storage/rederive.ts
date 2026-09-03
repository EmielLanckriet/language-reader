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
