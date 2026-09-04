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
import { codePointsOf } from '../domain/offsets';
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
/**
 * How far an upgrade to a better analyzer has reached, when one is under way (ADR-0016).
 *
 * Absent on a document that is not mid-upgrade, which is every document until a batch lands and
 * every document again once the last one does.
 */
export interface PartialUpgrade {
	analyzer: string;
	version: string;
	/** Character offset. Tokens before it came from this analyzer; tokens from it on did not. */
	through: number;
}

/**
 * One instalment of an upgrade: the tokens for a stretch of the document, and where that stretch
 * begins and ends.
 *
 * `from` and `through` are character offsets on segmentation-unit boundaries, and `tokens` tile
 * exactly `[from, through)` with absolute offsets into the whole document.
 */
export interface UpgradeBatch {
	from: number;
	through: number;
	tokens: ResolvedToken[];
}

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
	/** Present only while an upgrade is part-way through this document (ADR-0016). */
	upgrade?: PartialUpgrade;
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

	/**
	 * Replace a document's tokens with those of a different analyzer, and restamp it.
	 *
	 * This is the whole of re-derivation as far as storage is concerned, and it is deliberately one
	 * operation rather than three. Deleting tokens, inserting the new ones and updating the stamp
	 * must succeed or fail together: a document holding one analyzer's tokens under another
	 * analyzer's name is a lie no later reader could detect, and it is exactly what an interrupted
	 * three-step update would leave behind (FR-020).
	 *
	 * Reads nothing the reader earned and writes nothing they earned. `raw_content` is untouched;
	 * so are `status_event` and `word_state`. Lexemes are created for words that did not exist
	 * before and **none are deleted**, because marks point at them (FR-025).
	 *
	 * The tiling check runs before anything is written, for the same reason it does in
	 * `saveDocument`: tokens that do not tile would store text the reader could never see all of.
	 */
	replaceTokens(documentId: DocumentId, tokens: ResolvedToken[], analyzer: AnalyzerStamp): void {
		const rows = queryRows(this.db, 'SELECT raw_content, language FROM document WHERE id = ?', [
			documentId
		]);
		if (rows.length === 0) throw new StorageFailure(`No document with id ${documentId}.`);

		const rawContent = String(rows[0].raw_content);
		const language = String(rows[0].language);

		const problems = checkTiling(tokens, rawContent);
		if (problems.length > 0) {
			throw new StorageFailure(
				`${analyzer.name} v${analyzer.version} produced tokens that do not tile the document: ` +
					problems.join('; ')
			);
		}

		transact(this.db, () => {
			run(this.db, 'DELETE FROM token WHERE document_id = ?', [documentId]);

			for (const token of tokens) {
				const lexemeId =
					token.isWord && token.lexemeKey !== undefined
						? this.findOrCreateLexeme(language, token.lexemeKey)
						: null;

				run(
					this.db,
					'INSERT INTO token (document_id, lexeme_id, start, end, is_word) VALUES (?, ?, ?, ?, ?)',
					[documentId, lexemeId, token.start, token.end, token.isWord ? 1 : 0]
				);
			}

			// Every token in the document now came from this analyzer, so any partial upgrade that
			// was under way is not merely finished — it never happened, as far as what is stored is
			// concerned. Leaving the record behind would leave a boundary describing tokens that no
			// longer exist, which is precisely the disagreement FR-020 forbids.
			run(
				this.db,
				`UPDATE document
            SET analyzer = ?, analyzer_version = ?,
                upgrade_analyzer = NULL, upgrade_version = NULL, upgraded_through = 0
          WHERE id = ?`,
				[analyzer.name, analyzer.version, documentId]
			);
		});
	}

	/**
	 * Advance a document's upgrade by one batch, and record how far it has now reached (ADR-0016).
	 *
	 * This is `replaceTokens` for a document too slow to re-derive in one go. The model costs about
	 * 4 s per 1,000 characters, so a whole-document write meant an interruption at 26 of 27 seconds
	 * discarded all 26 — and on a phone that is the ordinary outcome, not the unlucky one
	 * (research.md R20). Here each batch is durable the moment it lands.
	 *
	 * The invariant this method exists to keep, checked rather than assumed:
	 *
	 *   Tokens before `upgraded_through` came from the upgrade analyzer; tokens from it onward came
	 *   from the document's own stamp.
	 *
	 * Which is why a batch must begin exactly where the recorded upgrade left off. A gap would leave
	 * a stretch of tokens on the wrong side of the boundary, claimed for an analyzer that never saw
	 * them — undetectable afterwards, which is the failure ADR-0011 is about.
	 *
	 * **A batch by a different analyzer starts again from the beginning**, and must cover everything
	 * the superseded upgrade wrote. A prefix from a model that is no longer in force is not a head
	 * start; leaving any of it in place would leave tokens the boundary describes wrongly.
	 *
	 * When the boundary reaches the end of the document the upgrade becomes the stamp and the record
	 * clears, in this same transaction — so no state exists in which a finished document still says
	 * it is mid-upgrade.
	 *
	 * Earned data is untouched, exactly as in `replaceTokens`: `raw_content`, `status_event` and
	 * `word_state` are not read or written here, and lexemes are created but never deleted (FR-025).
	 */
	advanceUpgrade(documentId: DocumentId, batch: UpgradeBatch, upgrade: AnalyzerStamp): void {
		const rows = queryRows(
			this.db,
			`SELECT raw_content, language, analyzer, analyzer_version,
              upgrade_analyzer, upgrade_version, upgraded_through
         FROM document WHERE id = ?`,
			[documentId]
		);
		if (rows.length === 0) throw new StorageFailure(`No document with id ${documentId}.`);

		const row = rows[0];
		const rawContent = String(row.raw_content);
		const language = String(row.language);
		const documentLength = codePointsOf(rawContent).length;

		if (batch.through <= batch.from) {
			throw new StorageFailure(
				`An upgrade batch must move forward; this one covers [${batch.from}, ${batch.through}).`
			);
		}
		if (batch.from < 0 || batch.through > documentLength) {
			throw new StorageFailure(
				`Batch [${batch.from}, ${batch.through}) falls outside a document of ${documentLength} characters.`
			);
		}
		if (row.analyzer === upgrade.name && row.analyzer_version === upgrade.version) {
			throw new StorageFailure(
				`Document ${documentId} is already stamped ${upgrade.name} v${upgrade.version}; there is nothing to upgrade.`
			);
		}

		const recorded =
			row.upgrade_analyzer === null || row.upgrade_analyzer === undefined
				? undefined
				: {
						analyzer: String(row.upgrade_analyzer),
						version: String(row.upgrade_version),
						through: Number(row.upgraded_through)
					};
		const continuing =
			recorded !== undefined &&
			recorded.analyzer === upgrade.name &&
			recorded.version === upgrade.version;

		if (continuing) {
			if (batch.from !== recorded.through) {
				throw new StorageFailure(
					`The upgrade of document ${documentId} reached ${recorded.through}, but this batch starts at ${batch.from}.`
				);
			}
		} else {
			if (batch.from !== 0) {
				throw new StorageFailure(
					`An upgrade to ${upgrade.name} v${upgrade.version} must start at the beginning of document ${documentId}, not at ${batch.from}.`
				);
			}
			if (recorded !== undefined && batch.through < recorded.through) {
				throw new StorageFailure(
					`Document ${documentId} was upgraded to ${recorded.through} by ${recorded.analyzer} v${recorded.version}; a batch replacing that upgrade must cover at least as much, not ${batch.through}.`
				);
			}
		}

		transact(this.db, () => {
			// No stored token may cross either edge of the batch. It cannot happen while both
			// analyzers respect the same segmentation units (ADR-0013), and if it ever does, half a
			// token would be deleted and the document would stop tiling — so it is checked here,
			// where the cause is still visible, rather than discovered later as missing text.
			const straddling = queryRows(
				this.db,
				`SELECT start, end FROM token
          WHERE document_id = ?
            AND ((start < ? AND end > ?) OR (start < ? AND end > ?))`,
				[documentId, batch.from, batch.from, batch.through, batch.through]
			);
			if (straddling.length > 0) {
				const spans = straddling.map((token) => `[${token.start}, ${token.end})`).join(', ');
				throw new StorageFailure(
					`Batch [${batch.from}, ${batch.through}) of document ${documentId} would cut stored tokens ${spans} in half.`
				);
			}

			run(this.db, 'DELETE FROM token WHERE document_id = ? AND start >= ? AND start < ?', [
				documentId,
				batch.from,
				batch.through
			]);

			for (const token of batch.tokens) {
				const lexemeId =
					token.isWord && token.lexemeKey !== undefined
						? this.findOrCreateLexeme(language, token.lexemeKey)
						: null;

				run(
					this.db,
					'INSERT INTO token (document_id, lexeme_id, start, end, is_word) VALUES (?, ?, ?, ?, ?)',
					[documentId, lexemeId, token.start, token.end, token.isWord ? 1 : 0]
				);
			}

			// Read back rather than reasoned about. `saveDocument` and `replaceTokens` can check the
			// tokens they were handed, because those are all the tokens there will be; a batch is
			// only part of a document, so the only way to know the *document* still tiles is to ask
			// it. The transaction rolls back if it does not.
			const stored = queryRows(
				this.db,
				'SELECT start, end FROM token WHERE document_id = ? ORDER BY start',
				[documentId]
			).map((token) => ({ start: Number(token.start), end: Number(token.end) }));

			const problems = checkTiling(stored, rawContent);
			if (problems.length > 0) {
				throw new StorageFailure(
					`${upgrade.name} v${upgrade.version} advancing document ${documentId} to ${batch.through} ` +
						`left tokens that do not tile it: ${problems.join('; ')}`
				);
			}

			if (batch.through === documentLength) {
				run(
					this.db,
					`UPDATE document
              SET analyzer = ?, analyzer_version = ?,
                  upgrade_analyzer = NULL, upgrade_version = NULL, upgraded_through = 0
            WHERE id = ?`,
					[upgrade.name, upgrade.version, documentId]
				);
			} else {
				run(
					this.db,
					`UPDATE document
              SET upgrade_analyzer = ?, upgrade_version = ?, upgraded_through = ?
            WHERE id = ?`,
					[upgrade.name, upgrade.version, batch.through, documentId]
				);
			}
		});
	}

	/**
	 * The documents whose tokens did not come from the analyzer now in use.
	 *
	 * Staleness is derived by comparing stamps rather than stored as a flag. A flag would be a
	 * second source of truth about the same fact, and the two could disagree — after an interrupted
	 * write, or after a browser update changed the segmenter's fingerprint underneath us. There is
	 * nothing here to fall out of step, and an interruption simply leaves the document stale, which
	 * is a safe resting state (FR-021).
	 */
	staleDocumentIds(analyzerName: string, analyzerVersion: string): DocumentId[] {
		return queryRows(
			this.db,
			`SELECT id FROM document
        WHERE analyzer IS NOT ? OR analyzer_version IS NOT ?
        ORDER BY id`,
			[analyzerName, analyzerVersion]
		).map((row) => Number(row.id));
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
			tokens,
			...(row.upgrade_analyzer === null || row.upgrade_analyzer === undefined
				? {}
				: {
						upgrade: {
							analyzer: String(row.upgrade_analyzer),
							version: String(row.upgrade_version),
							through: Number(row.upgraded_through)
						}
					})
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
