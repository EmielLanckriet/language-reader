/**
 * How far the background sweep has got with each document, where the interface can see it.
 *
 * The reader's page loads its tokens once. Before this, an upgrade that completed while a document
 * was open changed the database and nothing else: the words on screen stayed as they were until the
 * document happened to be closed and opened again, and nobody would think to do that. Which meant
 * that from the reader's side, the upgrade had simply never happened (research.md R20).
 *
 * Deliberately tiny, and deliberately not a copy of anything. It holds a boundary and a length —
 * the same two numbers the document itself records (ADR-0016) — and says only "this document moved".
 * What moved is read back from storage, which stays the one source of truth about tokens.
 */

import { SvelteMap } from 'svelte/reactivity';

const progress = new SvelteMap<number, { through: number; of: number }>();

/** Called by the sweep after every batch that lands. */
export function noteUpgraded(documentId: number, through: number, of: number): void {
	progress.set(documentId, { through, of });
}

/** How far this document has been taken during this visit, if it has been touched at all. */
export function upgradeOf(documentId: number): { through: number; of: number } | undefined {
	return progress.get(documentId);
}
