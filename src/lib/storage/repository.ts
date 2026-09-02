/**
 * Where domain types meet SQLite, and the only module besides db.ts permitted to know SQLite
 * exists (Constitution Principle V.4, enforced by tests/architecture/domain-purity.test.ts).
 *
 * See specs/001-reader-walking-skeleton/contracts/repository.md.
 */

import type { AnalyzerStamp, ResolvedToken } from '../analyzer/resolve';
import type { IngestedDocument } from '../content/types';
import type {
	DocumentId,
	HistoryEntry,
	LexemeId,
	Occurrence,
	Token,
	WordState
} from '../domain/types';
import { checkTiling } from '../domain/tiling';
import { assertion, inHistoryOrder } from '../domain/history';
import { projectStates } from '../domain/state';
import {
	type Database,
	deviceIdOf,
	lastInsertId,
	nextDeviceSeq,
	queryRows,
	run,
	transact
} from './db';

/** Enough to list a document without loading it. */
export interface DocumentSummary {
	id: DocumentId;
	title: string;
	createdAt: string;
	characterCount: number;
}

/**
 * A document and its tokens.
 *
 * Raw content *and* tokens, never tokens alone (contract obligation 1). Pagination,
 * re-segmentation and every future analyzer need the text, and a shape that returned only tokens
 * would have to be widened later — cheap in effort, but it is the kind of constraint that quietly
 * decides how slice 1 caches things.
 */
export interface StoredDocument {
	id: DocumentId;
	rawContent: string;
	contentType: string;
	language: string;
	analyzer: string;
	analyzerVersion: string;
	title: string;
	createdAt: string;
	tokens: Token[];
}

/** Raised when storage itself fails, as distinct from input being refused (FR-022). */
export { StorageFailure } from './failures';
import { StorageFailure } from './failures';

export class Repository {
	constructor(private readonly db: Database) {}

	/**
	 * Store a document and the tokens derived from it.
	 *
	 * The tiling check is not defensive programming: an analyzer whose tokens do not tile the
	 * document would store text the reader could never see all of, and the failure would look like
	 * missing content rather than like a broken analyzer (FR-005).
	 */
	saveDocument(
		document: IngestedDocument,
		tokens: ResolvedToken[],
		analyzer: AnalyzerStamp
	): DocumentId {
		const problems = checkTiling(tokens, document.rawContent);
		if (problems.length > 0) {
			throw new StorageFailure(
				`${analyzer.name} v${analyzer.version} produced tokens that do not tile the document: ` +
					problems.join('; ')
			);
		}

		return transact(this.db, () => {
			run(
				this.db,
				`INSERT INTO document
           (raw_content, content_type, language, analyzer, analyzer_version, title, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
				[
					document.rawContent,
					document.contentType,
					document.language,
					analyzer.name,
					analyzer.version,
					document.title,
					new Date().toISOString()
				]
			);
			const documentId = lastInsertId(this.db);

			for (const token of tokens) {
				const lexemeId =
					token.isWord && token.lexemeKey !== undefined
						? this.findOrCreateLexeme(document.language, token.lexemeKey)
						: null;

				run(
					this.db,
					'INSERT INTO token (document_id, lexeme_id, start, end, is_word) VALUES (?, ?, ?, ?, ?)',
					[documentId, lexemeId, token.start, token.end, token.isWord ? 1 : 0]
				);
			}

			return documentId;
		});
	}

	listDocuments(): DocumentSummary[] {
		return queryRows(
			this.db,
			`SELECT id, title, created_at, LENGTH(raw_content) AS approximate_length
         FROM document
        ORDER BY created_at DESC, id DESC`
		).map((row) => ({
			id: Number(row.id),
			title: String(row.title),
			createdAt: String(row.created_at),
			// SQLite's LENGTH counts characters for TEXT, which is what we want to show.
			characterCount: Number(row.approximate_length)
		}));
	}

	getDocument(id: DocumentId): StoredDocument {
		const rows = queryRows(this.db, 'SELECT * FROM document WHERE id = ?', [id]);
		if (rows.length === 0) throw new StorageFailure(`No document with id ${id}.`);
		const row = rows[0];

		const tokens = queryRows(
			this.db,
			'SELECT lexeme_id, start, end, is_word FROM token WHERE document_id = ? ORDER BY start',
			[id]
		).map((token) => ({
			start: Number(token.start),
			end: Number(token.end),
			isWord: Number(token.is_word) === 1,
			lexemeId: token.lexeme_id === null ? undefined : Number(token.lexeme_id)
		}));

		return {
			id: Number(row.id),
			rawContent: String(row.raw_content),
			contentType: String(row.content_type),
			language: String(row.language),
			analyzer: String(row.analyzer),
			analyzerVersion: String(row.analyzer_version),
			title: String(row.title),
			createdAt: String(row.created_at),
			tokens
		};
	}

	/**
	 * Record a judgment the reader made about a word.
	 *
	 * Appends to the history *first*, then updates the projection — never the reverse (contract
	 * obligation 2). The history is the source of truth and `word_state` is a cache of a fold over
	 * it, so an interruption must be able to lose the cache and not the evidence. Both happen in
	 * one transaction, along with the device counter they depend on: allocating a sequence number
	 * outside it would leave a gap indistinguishable from a lost entry.
	 */
	assertState(lexemeId: LexemeId, asserted: string, occurrence?: Occurrence): void {
		transact(this.db, () => {
			const deviceId = deviceIdOf(this.db);
			const entry = assertion({
				lexemeId,
				asserted,
				deviceId,
				deviceSeq: nextDeviceSeq(this.db, deviceId),
				assertedAt: new Date().toISOString(),
				occurrence
			});

			this.appendEvent(entry);
			this.writeProjectedState(projectStates([entry]).get(lexemeId)!);
		});
	}

	/** The current state of each of these words, omitting any the reader never judged (FR-006b). */
	getStates(lexemeIds: LexemeId[]): Map<LexemeId, WordState> {
		if (lexemeIds.length === 0) return new Map();

		const placeholders = lexemeIds.map(() => '?').join(', ');
		const rows = queryRows(
			this.db,
			`SELECT lexeme_id, state, provenance, user_id
         FROM word_state WHERE lexeme_id IN (${placeholders})`,
			lexemeIds
		);

		return new Map(
			rows.map((row) => [
				Number(row.lexeme_id),
				{
					lexemeId: Number(row.lexeme_id),
					state: String(row.state),
					provenance: String(row.provenance),
					userId: Number(row.user_id)
				}
			])
		);
	}

	/**
	 * The whole history, in replay order.
	 *
	 * The contract sketches this as an `AsyncIterable`, for a history too large to hold at once.
	 * It is an array here: sqlite-wasm's API is synchronous, slice 0's history is bounded by how
	 * fast a person can tap, and an array is the readable shape (Principle VII). Streaming it is
	 * an internal change if a real collection ever needs one.
	 */
	readHistory(): HistoryEntry[] {
		const rows = queryRows(
			this.db,
			`SELECT lexeme_id, asserted, asserted_at, device_id, device_seq,
              document_id, from_offset, to_offset, observed_pronunciation, provenance, user_id
         FROM status_event`
		);

		return inHistoryOrder(
			rows.map((row) =>
				assertion({
					lexemeId: Number(row.lexeme_id),
					asserted: String(row.asserted),
					assertedAt: String(row.asserted_at),
					deviceId: String(row.device_id),
					deviceSeq: Number(row.device_seq),
					provenance: String(row.provenance),
					userId: Number(row.user_id),
					occurrence:
						row.document_id === null
							? undefined
							: {
									documentId: Number(row.document_id),
									fromOffset: Number(row.from_offset),
									toOffset: Number(row.to_offset),
									...(row.observed_pronunciation === null
										? {}
										: { observedPronunciation: String(row.observed_pronunciation) })
								}
				})
			)
		);
	}

	/**
	 * Recompute every state from the history.
	 *
	 * This is the executable proof that `word_state` is derived rather than authoritative
	 * (contract obligation 3). Running it must change nothing; a test asserts exactly that. A
	 * projection nobody rebuilds is a claim, not a property.
	 */
	rebuildProjection(): void {
		const states = projectStates(this.readHistory());
		transact(this.db, () => {
			run(this.db, 'DELETE FROM word_state');
			for (const state of states.values()) this.writeProjectedState(state);
		});
	}

	private appendEvent(entry: HistoryEntry): void {
		run(
			this.db,
			`INSERT INTO status_event
         (lexeme_id, asserted, asserted_at, device_id, device_seq,
          document_id, from_offset, to_offset, observed_pronunciation, provenance, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				entry.lexemeId,
				entry.asserted,
				entry.assertedAt,
				entry.deviceId,
				entry.deviceSeq,
				entry.occurrence?.documentId ?? null,
				entry.occurrence?.fromOffset ?? null,
				entry.occurrence?.toOffset ?? null,
				entry.occurrence?.observedPronunciation ?? null,
				entry.provenance,
				entry.userId
			]
		);
	}

	private writeProjectedState(state: WordState): void {
		run(
			this.db,
			`INSERT INTO word_state (lexeme_id, state, provenance, user_id)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (lexeme_id) DO UPDATE
         SET state = excluded.state,
             provenance = excluded.provenance,
             user_id = excluded.user_id`,
			[state.lexemeId, state.state, state.provenance, state.userId]
		);
	}

	/**
	 * Find the lexeme this key belongs to, creating it if this is its first appearance.
	 *
	 * The key was decided by the language provider, never by this module (FR-009). The repository's
	 * only contribution is the surrogate id — which is precisely what makes the rule revisable:
	 * when it changes, accumulated marks stay attached to their ids (ADR-0002).
	 */
	findOrCreateLexeme(language: string, key: string): LexemeId {
		const existing = queryRows(
			this.db,
			'SELECT id FROM lexeme WHERE language = ? AND surface = ?',
			[language, key]
		);
		if (existing.length > 0) return Number(existing[0].id);

		run(this.db, 'INSERT INTO lexeme (language, surface) VALUES (?, ?)', [language, key]);
		return lastInsertId(this.db);
	}
}
