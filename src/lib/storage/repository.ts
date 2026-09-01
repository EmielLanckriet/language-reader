/**
 * Where domain types meet SQLite, and the only module besides db.ts permitted to know SQLite
 * exists (Constitution Principle V.4, enforced by tests/architecture/domain-purity.test.ts).
 *
 * See specs/001-reader-walking-skeleton/contracts/repository.md.
 */

import type { Analyzer, AnalyzedToken } from '../analyzer/types';
import type { IngestedDocument } from '../content/types';
import type { DocumentId, LexemeId, Token } from '../domain/types';
import { checkTiling } from '../domain/tiling';
import { codePointsOf } from '../domain/offsets';
import { type Database, lastInsertId, queryRows, run, transact } from './db';

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
export class StorageFailure extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'StorageFailure';
	}
}

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
		tokens: AnalyzedToken[],
		analyzer: Analyzer
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

			// Converted once rather than per token: slicing by code point walks the whole string,
			// and a 5,000-character document has 5,000 tokens.
			const characters = codePointsOf(document.rawContent);

			for (const token of tokens) {
				const lexemeId = token.isWord
					? this.findOrCreateLexeme(
							document.language,
							characters.slice(token.start, token.end).join(''),
							analyzer
						)
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
	 * Find the lexeme this surface form belongs to, creating it if this is its first appearance.
	 *
	 * The key comes from the language provider, never from this module's opinion (FR-009). The
	 * repository's only contribution is the surrogate id — which is precisely what makes the rule
	 * revisable: when it changes, accumulated marks stay attached to their ids (ADR-0002).
	 */
	findOrCreateLexeme(language: string, surface: string, analyzer: Analyzer): LexemeId {
		const key = analyzer.lexemeKey(surface);

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
