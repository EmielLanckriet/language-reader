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
import {
	applyCorrections,
	problemWith,
	rulesInForce,
	type Correction,
	type Part
} from '../domain/corrections';
import { codePointsOf } from '../domain/offsets';
import { helpOf, isHelped, lineRangesOf, type Help } from '../domain/helped';
import { assertion, inHistoryOrder } from '../domain/history';
import { evaluateDataset, TUNING_SCHEDULER, type TuningDataset } from '../domain/tuning';
import { RULE } from '../domain/memory';
import { studyWeek, type StudyOverview, type StudySession } from '../domain/study';
import { projectStates, RETRACTED } from '../domain/state';
import { MAX_RANGE, validateEncounter, type Encounter, type Modality } from '../domain/encounter';
import { checkedExample, type AnkiExample } from '../domain/card-examples';
import type { FsrsParameters } from '../domain/anki';
import {
	memoryOf,
	ruleKey,
	type Exposure,
	type HistoryEvent,
	type Mark,
	type Memory,
	type WordHistory
} from '../domain/memory';
import type { AttentionAnswer, Engagement, Skill } from '../domain/encounter';
import { cardQueue, type Queue } from '../domain/queue';
import {
	type Database,
	type Row,
	deviceIdOf,
	lastInsertId,
	nextDeviceSeq,
	queryRows,
	run,
	transact
} from './db';

export interface RecentSession {
	title: string;
	modality: string;
	startedAt: string;
	encounters: {
		kind: string;
		word?: string;
		mediaMs?: number;
		speed?: number;
		textVisible?: boolean;
		detail: string;
		at: string;
	}[];
}

function memoryFromRow(row: Row): Memory {
	return {
		stability: Number(row.stability),
		difficulty: Number(row.difficulty),
		state: Number(row.state),
		lastAt: String(row.last_at),
		due: String(row.due),
		reps: Number(row.reps),
		lapses: Number(row.lapses),
		card: row.card === 1,
		reviewed: row.reviewed === 1,
		...(row.seeded === null ? {} : { seeded: String(row.seeded) })
	};
}

/** A sentence a card shows its word in (research R9), in code points of its document. */
export interface CardSentence {
	source: 'reader' | 'anki';
	sourceTitle: string;
	sourceKey: string;
	available: boolean;
	documentId?: DocumentId;
	translation?: string;
	wordAudio?: string;
	sentenceAudio?: string;
	lineText?: string;
	lineFrom?: number;
	/** The sentence's range in the document. */
	from: number;
	to: number;
	text: string;
	/** The word's range within `text`. */
	wordFrom: number;
	wordTo: number;
	/** Its line in the document, which for a video is its subtitle line. */
	line: number;
}

export interface CardsToday {
	queue: Queue;
	words: Record<LexemeId, string>;
	counts: { due: number; fresh: number; awaitingContext: number };
}

/** A card's sentence ends at these, and at a line break. */
const SENTENCE_ENDS = new Set(['。', '！', '？', '!', '?']);

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
import { CopyRejected, FORMAT, type CopyBody } from '../backup/format';
import { ankiImportOf, planImport, type AnkiExport } from '../domain/anki';

/** Every word a stretch covered in a session answered "I tapped every word I didn't know". */
/**
 * Sessions the reader withdrew (a test, a mistake): their encounters stay in the history, which is
 * append-only, but count for nothing in memory (ADR-0030).
 */
/** Checked when written, but a restored copy is not, so a missing field reads as not answered. */
function engagementOf(detail: string): Engagement {
	const { mode, attentive } = JSON.parse(detail);
	return { mode: mode ?? null, attentive: attentive ?? null };
}

const WITHDRAWN = `SELECT session_id FROM encounter WHERE kind = 'withdrawn' AND session_id IS NOT NULL`;
const ENCOUNTERED_TOKEN = `EXISTS (SELECT 1 FROM encounter e
 WHERE e.document_id=t.document_id AND e.from_offset<=t.start AND e.to_offset>=t.end
 AND e.kind IN ('read','played','lookup','check')
 AND (e.session_id IS NULL OR e.session_id NOT IN (${WITHDRAWN})))`;

const ATTENTIVELY_SEEN = `
  SELECT DISTINCT t.lexeme_id FROM encounter a
    JOIN encounter e ON e.session_id = a.session_id AND e.kind IN ('read', 'played')
    JOIN token t ON t.document_id = e.document_id
                AND t.start < e.to_offset AND t.end > e.from_offset
   WHERE a.kind = 'attention' AND json_extract(a.detail, '$.answer') = 'all'
     AND a.session_id NOT IN (${WITHDRAWN})
     AND t.lexeme_id IS NOT NULL`;

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
			this.storeTokens(documentId, document.language, document.rawContent, tokens, 0, Infinity);
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
			const remembered = this.memoryWordsIn(documentId, 0, Infinity);
			this.storeTokens(documentId, language, rawContent, tokens, 0, Infinity);

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
			// The words its stretches covered are its tokens, which just changed (research R4).
			for (const id of this.memoryWordsIn(documentId, 0, Infinity)) remembered.add(id);
			this.recomputeMemory(remembered);
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

			const remembered = this.memoryWordsIn(documentId, batch.from, batch.through);
			this.storeTokens(documentId, language, rawContent, batch.tokens, batch.from, batch.through);

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

			for (const id of this.memoryWordsIn(documentId, batch.from, batch.through))
				remembered.add(id);
			this.recomputeMemory(remembered);

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

	/**
	 * Delete a document, or hide it when any history points into it (spec 007, research R11).
	 *
	 * A mark, a session or an encounter made in a document is earned data, and its offsets mean
	 * something only while the text is there. Such a document is hidden from the library and kept,
	 * text and tokens alike; one nothing points at is deleted outright. Lexemes are never deleted
	 * here, because marks point at them whichever document they came from. Its media files are the
	 * caller's (media/store.ts).
	 */
	removeDocument(id: DocumentId): 'deleted' | 'hidden' {
		return transact(this.db, () => {
			const pointing = queryRows(
				this.db,
				`SELECT (SELECT COUNT(*) FROM status_event WHERE document_id = ?)
              + (SELECT COUNT(*) FROM session WHERE document_id = ?)
              + (SELECT COUNT(*) FROM encounter WHERE document_id = ?)
              + (SELECT COUNT(*) FROM correction_event WHERE document_id = ?) AS n`,
				[id, id, id, id]
			)[0];
			if (Number(pointing.n) > 0) {
				run(this.db, 'UPDATE document SET removed_at = ? WHERE id = ? AND removed_at IS NULL', [
					new Date().toISOString(),
					id
				]);
				return 'hidden';
			}
			run(this.db, 'DELETE FROM token WHERE document_id = ?', [id]);
			run(this.db, 'DELETE FROM analyzed_token WHERE document_id = ?', [id]);
			run(this.db, 'DELETE FROM document WHERE id = ?', [id]);
			return 'deleted';
		});
	}

	/** How far into each of these videos playback has reached, in ms: the library's progress. */
	playedThrough(documentIds: DocumentId[]): Map<DocumentId, number> {
		if (documentIds.length === 0) return new Map();
		const rows = queryRows(
			this.db,
			`SELECT document_id, MAX(json_extract(detail, '$.toMs')) AS through FROM encounter
        WHERE kind = 'played' AND document_id IN (${documentIds.map(() => '?').join(', ')})
        GROUP BY document_id`,
			documentIds
		);
		return new Map(rows.map((row) => [Number(row.document_id), Number(row.through)]));
	}

	/** How often each word occurs in each of these documents, for the library's shares. */
	wordOccurrences(documentIds: DocumentId[]): Map<DocumentId, Map<LexemeId, number>> {
		const found = new Map<DocumentId, Map<LexemeId, number>>();
		if (documentIds.length === 0) return found;
		const rows = queryRows(
			this.db,
			`SELECT document_id, lexeme_id, COUNT(*) AS n FROM token
        WHERE is_word = 1 AND document_id IN (${documentIds.map(() => '?').join(', ')})
        GROUP BY document_id, lexeme_id`,
			documentIds
		);
		for (const row of rows) {
			const id = Number(row.document_id);
			const words = found.get(id) ?? new Map<LexemeId, number>();
			words.set(Number(row.lexeme_id), Number(row.n));
			found.set(id, words);
		}
		return found;
	}

	listDocuments(): DocumentSummary[] {
		return queryRows(
			this.db,
			`SELECT id, title, created_at, LENGTH(raw_content) AS approximate_length
         FROM document
        WHERE removed_at IS NULL
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
			this.projectEntry(entry);
		});
	}

	/**
	 * Update the stored state for one new event, which is all the log's fold does for one entry: the
	 * event's state, or none at all after a retraction (ADR-0024).
	 */
	private projectEntry(entry: HistoryEntry): void {
		const state = projectStates([entry]).get(entry.lexemeId);
		if (state) this.writeProjectedState(state);
		else run(this.db, 'DELETE FROM word_state WHERE lexeme_id = ?', [entry.lexemeId]);
		this.recomputeMemory([entry.lexemeId]);
	}

	/**
	 * Record how the reader says a form divides, or with `parts` null that they take it back
	 * (spec 004), and show it in every document that contains the form.
	 *
	 * Appended first and applied second, in one transaction, as with a mark. The rewrite reads the
	 * analyzer's own tokens rather than the corrected ones, so undoing a join finds the analyzer's
	 * split again without running the analyzer (FR-011).
	 */
	correct(language: string, form: string, parts: Part[] | null, occurrence?: Occurrence): void {
		const problem = problemWith(form, parts ?? undefined);
		if (problem) throw new StorageFailure(`Cannot record that correction: ${problem}.`);

		transact(this.db, () => {
			const deviceId = deviceIdOf(this.db);
			run(
				this.db,
				`INSERT INTO correction_event
           (language, form, parts, made_at, device_id, device_seq, document_id, from_offset, to_offset)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					language,
					form,
					parts ? JSON.stringify(parts) : null,
					new Date().toISOString(),
					deviceId,
					nextDeviceSeq(this.db, deviceId),
					occurrence?.documentId ?? null,
					occurrence?.fromOffset ?? null,
					occurrence?.toOffset ?? null
				]
			);

			const documents = queryRows(
				this.db,
				'SELECT id, raw_content FROM document WHERE language = ? AND instr(raw_content, ?) > 0',
				[language, form]
			);
			for (const row of documents) {
				const documentId = Number(row.id);
				const analyzed = queryRows(
					this.db,
					'SELECT start, end, is_word, lexeme_key FROM analyzed_token WHERE document_id = ? ORDER BY start',
					[documentId]
				).map((token) => ({
					start: Number(token.start),
					end: Number(token.end),
					isWord: Number(token.is_word) === 1,
					...(token.lexeme_key === null ? {} : { lexemeKey: String(token.lexeme_key) })
				}));
				const remembered = this.memoryWordsIn(documentId, 0, Infinity);
				const before = this.tokenSpans(documentId);
				this.writeCorrected(documentId, language, String(row.raw_content), analyzed, 0, Infinity);
				for (const id of this.memoryWordsIn(documentId, 0, Infinity)) remembered.add(id);
				// Only a word whose tokens moved can have a different memory: its exposures are its
				// tokens under a read or played stretch. Recomputing every remembered word of the document
				// took 1.5 s of a 2.1 s correction on a 44 min transcript (laptop; the phone is slower).
				const after = this.tokenSpans(documentId);
				const moved = new Set<LexemeId>();
				for (const [span, id] of before) if (after.get(span) !== id) moved.add(id);
				for (const [span, id] of after) if (before.get(span) !== id) moved.add(id);
				this.recomputeMemory(new Set([...remembered].filter((id) => moved.has(id))));
			}
		});
	}

	/** Every correction and undo, in the order the reader made them. */
	readCorrections(): Correction[] {
		return queryRows(this.db, 'SELECT * FROM correction_event ORDER BY device_id, device_seq').map(
			(row) => ({
				language: String(row.language),
				form: String(row.form),
				...(row.parts === null ? {} : { parts: JSON.parse(String(row.parts)) as Part[] }),
				madeAt: String(row.made_at),
				deviceId: String(row.device_id),
				deviceSeq: Number(row.device_seq),
				userId: Number(row.user_id),
				...(row.document_id === null
					? {}
					: {
							occurrence: {
								documentId: Number(row.document_id),
								fromOffset: Number(row.from_offset),
								toOffset: Number(row.to_offset)
							}
						})
			})
		);
	}

	/** The corrections in force, most recent first, whether or not any document shows them (US3). */
	corrections(): { language: string; form: string; parts: string[]; madeAt: string }[] {
		const history = this.readCorrections();
		const inForce = new Map<string, Correction>();
		for (const correction of history) {
			const key = `${correction.language}\u0000${correction.form}`;
			inForce.delete(key);
			if (correction.parts) inForce.set(key, correction);
		}
		return [...inForce.values()].reverse().map((correction) => ({
			language: correction.language,
			form: correction.form,
			parts: correction.parts!.map((part) => part.surface),
			madeAt: correction.madeAt
		}));
	}

	/**
	 * Store an analyzer's tokens for `[from, through)` of a document, and beside them the tokens
	 * the reader sees: the same ones with the corrections in force applied. The one place tokens
	 * are written, so no path can store the one without the other.
	 */
	private storeTokens(
		documentId: DocumentId,
		language: string,
		rawContent: string,
		tokens: ResolvedToken[],
		from: number,
		through: number
	): void {
		run(this.db, 'DELETE FROM analyzed_token WHERE document_id = ? AND start >= ? AND start < ?', [
			documentId,
			from,
			Number.isFinite(through) ? through : Number.MAX_SAFE_INTEGER
		]);
		for (const token of tokens) {
			run(
				this.db,
				'INSERT INTO analyzed_token (document_id, start, end, is_word, lexeme_key) VALUES (?, ?, ?, ?, ?)',
				[documentId, token.start, token.end, token.isWord ? 1 : 0, token.lexemeKey ?? null]
			);
		}
		this.writeCorrected(documentId, language, rawContent, tokens, from, through);
	}

	/** A document's word tokens, as start:end to the word there. */
	private tokenSpans(documentId: DocumentId): Map<string, LexemeId> {
		return new Map(
			queryRows(
				this.db,
				'SELECT start, end, lexeme_id FROM token WHERE document_id = ? AND lexeme_id IS NOT NULL',
				[documentId]
			).map((row) => [`${row.start}:${row.end}`, Number(row.lexeme_id)])
		);
	}

	private writeCorrected(
		documentId: DocumentId,
		language: string,
		rawContent: string,
		analyzed: ResolvedToken[],
		from: number,
		through: number
	): void {
		run(this.db, 'DELETE FROM token WHERE document_id = ? AND start >= ? AND start < ?', [
			documentId,
			from,
			Number.isFinite(through) ? through : Number.MAX_SAFE_INTEGER
		]);
		const rules = rulesInForce(this.readCorrections(), language);
		// One statement for every row, and each word looked up once: row by row, a 44 min transcript's
		// 9,000 tokens took 0.5 s on the laptop.
		const lexemes = new Map<string, LexemeId>();
		const insert = this.db.prepare(
			'INSERT INTO token (document_id, lexeme_id, start, end, is_word) VALUES (?, ?, ?, ?, ?)'
		);
		try {
			for (const token of applyCorrections(codePointsOf(rawContent), analyzed, rules)) {
				let lexemeId: LexemeId | null = null;
				if (token.isWord && token.lexemeKey !== undefined) {
					lexemeId =
						lexemes.get(token.lexemeKey) ?? this.findOrCreateLexeme(language, token.lexemeKey);
					lexemes.set(token.lexemeKey, lexemeId);
				}
				insert
					.bind([documentId, lexemeId, token.start, token.end, token.isWord ? 1 : 0])
					.stepReset();
			}
		} finally {
			insert.finalize();
		}
	}

	/**
	 * Begin a sitting with one document (spec 007). The session row is written once and never
	 * changed: its end is its last encounter, and the attention answer is an encounter of its own.
	 */
	startSession(documentId: DocumentId, modality: Modality): number {
		return transact(this.db, () => {
			const deviceId = deviceIdOf(this.db);
			run(
				this.db,
				`INSERT INTO session (document_id, modality, started_at, device_id, device_seq)
         VALUES (?, ?, ?, ?, ?)`,
				[documentId, modality, new Date().toISOString(), deviceId, nextDeviceSeq(this.db, deviceId)]
			);
			return lastInsertId(this.db);
		});
	}

	/**
	 * Append a batch of encounters to a session: all of them or none (ADR-0027). Each takes its
	 * place on the device counter status events use, so the whole history has one order.
	 */
	recordEncounters(sessionId: number, encounters: Encounter[]): void {
		transact(this.db, () => {
			const exists = queryRows(this.db, 'SELECT 1 FROM session WHERE id = ?', [sessionId]);
			if (exists.length === 0) throw new StorageFailure(`There is no session ${sessionId}.`);
			for (const encounter of encounters) this.appendEncounter(sessionId, encounter);
			this.recomputeMemory(this.touchedBy(sessionId, encounters));
		});
	}

	/**
	 * Take back a session: a test, or a sitting the reader does not want counted (ADR-0030). Nothing
	 * is removed; a `withdrawn` encounter joins it, and every word it touched is recomputed without it.
	 */
	withdrawSession(sessionId: number, reason: string): void {
		this.recordEncounters(sessionId, [
			{ kind: 'withdrawn', at: new Date().toISOString(), detail: { reason } }
		]);
	}

	/** Deleted documents whose sessions still count, newest first: what the reader can take back. */
	deletedWithHistory(): { id: DocumentId; title: string; sessions: number; lookups: number }[] {
		return queryRows(
			this.db,
			`SELECT d.id, d.title, COUNT(DISTINCT s.id) AS sessions,
              COUNT(CASE WHEN e.kind IN ('lookup', 'check') THEN 1 END) AS lookups
         FROM document d JOIN session s ON s.document_id = d.id
         LEFT JOIN encounter e ON e.session_id = s.id
        WHERE d.removed_at IS NOT NULL AND s.id NOT IN (${WITHDRAWN})
        GROUP BY d.id ORDER BY d.removed_at DESC`
		).map((row) => ({
			id: Number(row.id),
			title: String(row.title),
			sessions: Number(row.sessions),
			lookups: Number(row.lookups)
		}));
	}

	/** Every session in this document not yet withdrawn, withdrawn together (ADR-0030). */
	withdrawDocument(documentId: DocumentId, reason: string): void {
		// One transaction, and each word recomputed once however many sessions touched it. Through
		// withdrawSession, each nested a transaction in this one, which SQLite refuses.
		transact(this.db, () => {
			const touched = new Set<LexemeId>();
			for (const row of queryRows(
				this.db,
				`SELECT id FROM session WHERE document_id = ? AND id NOT IN (${WITHDRAWN})`,
				[documentId]
			)) {
				const withdrawal = { kind: 'withdrawn', at: new Date().toISOString(), detail: { reason } };
				this.appendEncounter(Number(row.id), withdrawal);
				for (const id of this.touchedBy(Number(row.id), [withdrawal])) touched.add(id);
			}
			this.recomputeMemory(touched);
		});
	}

	/**
	 * Record a flashcard grade (FR-007) and recompute the word's memory with it. `shown` is the
	 * sentence the card showed, so a later review can show another.
	 */
	recordReview(
		lexemeId: LexemeId,
		grade: number,
		shown: Occurrence | undefined,
		at: string = new Date().toISOString(),
		exampleKey?: string
	): void {
		transact(this.db, () => {
			this.appendEncounter(null, {
				kind: 'review',
				at,
				lexemeId,
				...(shown
					? { documentId: shown.documentId, fromOffset: shown.fromOffset, toOffset: shown.toOffset }
					: {}),
				detail: { skill: 'reading', grade, ...(exampleKey ? { exampleKey } : {}) }
			});
			this.recomputeMemory([lexemeId]);
		});
	}

	/**
	 * The words whose memory a batch of encounters can change (research R6): the word of a lookup,
	 * check or review, and for an attention answer every word the session's stretches covered
	 * (evidence-2 starts a memory for a word met untapped in an attentive session). English shown
	 * once the session is answered touches them too: it takes that credit back (evidence-3). Before
	 * the answer it needs nothing, as nothing was credited yet.
	 */
	private touchedBy(sessionId: number, encounters: Encounter[]): Set<LexemeId> {
		const touched = new Set<LexemeId>();
		for (const encounter of encounters) {
			if (encounter.lexemeId !== undefined) touched.add(encounter.lexemeId);
			if (encounter.kind === 'withdrawn')
				for (const row of queryRows(
					this.db,
					'SELECT DISTINCT lexeme_id FROM encounter WHERE session_id = ? AND lexeme_id IS NOT NULL',
					[sessionId]
				))
					touched.add(Number(row.lexeme_id));
			const shownAfterAnswer =
				(encounter.kind === 'translation' || encounter.kind === 'setting') &&
				queryRows(
					this.db,
					`SELECT 1 FROM encounter WHERE session_id = ? AND kind = 'attention' LIMIT 1`,
					[sessionId]
				).length > 0;
			if (encounter.kind !== 'attention' && encounter.kind !== 'withdrawn' && !shownAfterAnswer)
				continue;
			for (const row of queryRows(
				this.db,
				`SELECT DISTINCT t.lexeme_id FROM encounter e
         JOIN token t ON t.document_id = e.document_id
                     AND t.start < e.to_offset AND t.end > e.from_offset
         WHERE e.session_id = ? AND e.kind IN ('read', 'played') AND t.lexeme_id IS NOT NULL`,
				[sessionId]
			))
				touched.add(Number(row.lexeme_id));
		}
		return touched;
	}

	/** Where English was shown in each session of these exposure rows (helped.ts). */
	private englishShown(rows: Row[]): Map<number, Help> {
		const help = new Map<number, Help>();
		const lines = new Map<number, [number, number][]>();
		for (const row of rows) {
			const session = Number(row.session_id);
			if (help.has(session)) continue;
			const documentId = Number(row.document_id);
			if (!lines.has(documentId)) {
				const raw = queryRows(this.db, 'SELECT raw_content FROM document WHERE id = ?', [
					documentId
				])[0]?.raw_content;
				lines.set(documentId, lineRangesOf(codePointsOf(String(raw ?? ''))));
			}
			const shown = queryRows(
				this.db,
				`SELECT kind, from_offset, to_offset, detail FROM encounter
         WHERE session_id = ? AND kind IN ('translation', 'setting') ORDER BY device_id, device_seq`,
				[session]
			).map((encounter) => ({
				kind: String(encounter.kind),
				...(encounter.from_offset === null ? {} : { fromOffset: Number(encounter.from_offset) }),
				...(encounter.to_offset === null ? {} : { toOffset: Number(encounter.to_offset) }),
				detail: JSON.parse(String(encounter.detail))
			}));
			help.set(session, helpOf(shown, lines.get(documentId)!));
		}
		return help;
	}

	/** The parameters the latest Anki import brought, or none (then ts-fsrs's defaults). */
	private currentParameters(): FsrsParameters | undefined {
		const latest = queryRows(
			this.db,
			`SELECT detail FROM encounter WHERE kind = 'anki-parameters'
       ORDER BY at DESC, device_id DESC, device_seq DESC LIMIT 1`
		)[0];
		if (!latest) return undefined;
		const { preset, weights, retention } = JSON.parse(String(latest.detail));
		return { preset, weights, retention };
	}

	/** Read-only evaluation snapshot. Original encounters remain authoritative, including withdrawals. */
	tuningDataset(): TuningDataset {
		// Every word with an outcome to score (spec 013): a review, a tap, or a reading in a session
		// answered "every unknown word". Words met only otherwise could not be scored.
		const words = queryRows(
			this.db,
			`SELECT lexeme_id FROM encounter
			WHERE kind IN ('review', 'lookup', 'check') AND lexeme_id IS NOT NULL
			AND (session_id IS NULL OR session_id NOT IN (${WITHDRAWN}))
			UNION SELECT lexeme_id FROM (${ATTENTIVELY_SEEN})
			ORDER BY lexeme_id`
		).map((row) => {
			const id = Number(row.lexeme_id);
			const history = this.wordHistory(id);
			return { id, history: { ...history, answers: [...history.answers] } };
		});
		return {
			format: 2,
			rule: RULE,
			scheduler: TUNING_SCHEDULER,
			exportedAt: new Date().toISOString(),
			parameters: this.currentParameters(),
			words
		};
	}

	tuningAnalysis() {
		const data = this.tuningDataset();
		return { data, report: evaluateDataset(data) };
	}

	/** Everything in the history that bears on one word (contracts/evidence-rule.md). */
	private wordHistory(lexemeId: LexemeId): WordHistory {
		const ordered = (row: Row) => ({
			deviceId: String(row.device_id),
			deviceSeq: Number(row.device_seq),
			at: String(row.at)
		});
		const marks: Mark[] = queryRows(
			this.db,
			`SELECT asserted, provenance, asserted_at AS at, device_id, device_seq
       FROM status_event WHERE lexeme_id = ?`,
			[lexemeId]
		).map((row) => ({
			...ordered(row),
			asserted: String(row.asserted),
			provenance: String(row.provenance)
		}));
		const optional = (row: Row) => ({
			...(row.session_id === null ? {} : { sessionId: Number(row.session_id) }),
			...(row.modality === null ? {} : { modality: String(row.modality) as Modality }),
			...(row.text_visible === null ? {} : { textVisible: row.text_visible === 1 })
		});
		const events: HistoryEvent[] = queryRows(
			this.db,
			`SELECT e.kind, e.session_id, s.modality, e.text_visible, e.detail, e.at, e.device_id, e.device_seq
       FROM encounter e LEFT JOIN session s ON s.id = e.session_id
       WHERE e.lexeme_id = ? AND e.kind IN ('lookup', 'check', 'review')
         AND (e.session_id IS NULL OR e.session_id NOT IN (${WITHDRAWN}))`,
			[lexemeId]
		).map((row) => ({
			...ordered(row),
			...optional(row),
			kind: String(row.kind),
			detail: JSON.parse(String(row.detail))
		}));
		// One exposure per session and text visibility, the earliest: the rule counts a word met in a
		// session at most once, and a session's every 5 s chunk covering the word made this the cost
		// of recomputing a busy word (measured 2026-09-27: 1.2 s a session at 20,000 encounters).
		// Grouped by occurrence too, so that whether English was shown over each one can be asked.
		const rows = queryRows(
			this.db,
			`SELECT e.session_id, s.modality, s.document_id, e.text_visible, MIN(e.device_seq) AS device_seq,
              e.device_id, MIN(e.at) AS at, t.start, t."end"
       FROM token t
       JOIN encounter e ON e.document_id = t.document_id
                       AND e.from_offset < t.end AND e.from_offset > t.start - ${MAX_RANGE}
                       AND e.to_offset > t.start AND e.kind IN ('read', 'played')
       JOIN session s ON s.id = e.session_id
       WHERE t.lexeme_id = ? AND e.session_id NOT IN (${WITHDRAWN})
       GROUP BY e.session_id, e.text_visible, e.device_id, t.start`,
			[lexemeId]
		);
		const helpIn = this.englishShown(rows);
		const grouped = new Map<string, Exposure>();
		for (const row of rows) {
			const key = `${row.session_id} ${row.text_visible} ${row.device_id}`;
			const helped = isHelped(
				helpIn.get(Number(row.session_id))!,
				Number(row.start),
				Number(row.end)
			);
			const kept = grouped.get(key);
			if (!kept) grouped.set(key, { ...ordered(row), ...optional(row), helped } as Exposure);
			else {
				// Helped only if every occurrence was; the earliest stands for the group.
				kept.helped = kept.helped && helped;
				if (Number(row.device_seq) < kept.deviceSeq) Object.assign(kept, ordered(row));
			}
		}
		const exposures = [...grouped.values()];
		const answers = new Map<number, AttentionAnswer>();
		const sessions = [...new Set(exposures.map((exposure) => exposure.sessionId))];
		if (sessions.length > 0) {
			for (const row of queryRows(
				this.db,
				`SELECT session_id, detail FROM encounter
         WHERE kind = 'attention' AND session_id IN (${sessions.map(() => '?').join(',')})
         ORDER BY device_id, device_seq`,
				sessions
			))
				answers.set(Number(row.session_id), JSON.parse(String(row.detail)).answer);
		}
		return { marks, events, exposures, answers };
	}

	/** Recompute these words' memory rows from their history, under the current rule (R6). */
	private recomputeMemory(lexemeIds: Iterable<LexemeId>): void {
		const parameters = this.currentParameters();
		const rule = ruleKey(parameters);
		for (const lexemeId of lexemeIds) {
			run(this.db, 'DELETE FROM memory WHERE lexeme_id = ?', [lexemeId]);
			const memory = memoryOf(this.wordHistory(lexemeId), parameters);
			for (const [skill, m] of Object.entries(memory) as [Skill, Memory][]) {
				run(
					this.db,
					`INSERT INTO memory (lexeme_id, skill, stability, difficulty, state, last_at, due, reps,
             lapses, card, reviewed, seeded, rule)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						lexemeId,
						skill,
						m.stability,
						m.difficulty,
						m.state,
						m.lastAt,
						m.due,
						m.reps,
						m.lapses,
						m.card ? 1 : 0,
						m.reviewed ? 1 : 0,
						m.seeded ?? null,
						rule
					]
				);
			}
		}
	}

	/**
	 * Build memory for a history that has none, as a library from before spec 007 does: its marks
	 * and Anki imports were written before there was a memory table to keep in step.
	 */
	ensureMemory(): void {
		const counts = queryRows(
			this.db,
			'SELECT (SELECT COUNT(*) FROM memory) AS memory, (SELECT COUNT(*) FROM status_event) AS marks'
		)[0];
		if (Number(counts.memory) === 0 && Number(counts.marks) > 0) this.rebuildMemory();
	}

	/** Every word's memory from nothing (SC-007): after a restore, or to check the incremental rows. */
	rebuildMemory(): void {
		transact(this.db, () => {
			run(this.db, 'DELETE FROM memory');
			this.recomputeMemory(this.wordsWithHistory());
		});
	}

	/**
	 * Words whose memory was computed under another rule than the current one (Principle VIII): kept
	 * and shown until the sweep recomputes them, a batch at a time.
	 */
	staleMemory(limit: number): LexemeId[] {
		const stale = queryRows(
			this.db,
			'SELECT DISTINCT lexeme_id FROM memory WHERE rule != ? LIMIT ?',
			[ruleKey(this.currentParameters()), limit]
		).map((row) => Number(row.lexeme_id));
		if (stale.length > 0) return stale;
		// Words evidence-1 gave no memory and evidence-2 does: met untapped in an attentive session.
		// An ignored word never gets a row, so it is left out, or the sweep would find it forever.
		return queryRows(
			this.db,
			`SELECT lexeme_id FROM (${ATTENTIVELY_SEEN})
        WHERE lexeme_id NOT IN (SELECT lexeme_id FROM memory)
          AND lexeme_id NOT IN (SELECT lexeme_id FROM word_state WHERE state = 'ignored')
        LIMIT ?`,
			[limit]
		).map((row) => Number(row.lexeme_id));
	}

	/** Recompute these words' memory: one batch of the sweep. */
	refreshMemory(lexemeIds: LexemeId[]): void {
		transact(this.db, () => this.recomputeMemory(lexemeIds));
	}

	/**
	 * The words among a document's tokens starting in [from, to) that have a memory, or can gain one:
	 * those an attentive session covered (evidence-2).
	 */
	private memoryWordsIn(documentId: DocumentId, from: number, to: number): Set<LexemeId> {
		return new Set(
			queryRows(
				this.db,
				`SELECT DISTINCT t.lexeme_id FROM token t
         WHERE t.document_id = ? AND t.start >= ? AND t.start < ? AND t.lexeme_id IS NOT NULL
           AND (t.lexeme_id IN (SELECT lexeme_id FROM memory) OR EXISTS (
                SELECT 1 FROM encounter e
                  JOIN encounter a ON a.session_id = e.session_id AND a.kind = 'attention'
                                  AND json_extract(a.detail, '$.answer') = 'all'
                 WHERE e.document_id = t.document_id AND e.kind IN ('read', 'played')
                   AND e.from_offset < t.end AND e.from_offset > t.start - ${MAX_RANGE}
                   AND e.to_offset > t.start))`,
				[documentId, from, Number.isFinite(to) ? to : Number.MAX_SAFE_INTEGER]
			).map((row) => Number(row.lexeme_id))
		);
	}

	/** Every word the history says anything about: the only ones that can have a memory. */
	private wordsWithHistory(): LexemeId[] {
		return queryRows(
			this.db,
			`SELECT lexeme_id FROM status_event UNION
       SELECT lexeme_id FROM encounter WHERE lexeme_id IS NOT NULL UNION
       ${ATTENTIVELY_SEEN}`
		).map((row) => Number(row.lexeme_id));
	}

	private appendEncounter(sessionId: number | null, encounter: Encounter): void {
		validateEncounter(encounter);
		const deviceId = deviceIdOf(this.db);
		run(
			this.db,
			`INSERT INTO encounter
         (session_id, kind, lexeme_id, document_id, from_offset, to_offset, media_ms, speed,
          text_visible, detail, at, device_id, device_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				sessionId,
				encounter.kind,
				encounter.lexemeId ?? null,
				encounter.documentId ?? null,
				encounter.fromOffset ?? null,
				encounter.toOffset ?? null,
				encounter.mediaMs ?? null,
				encounter.speed ?? null,
				encounter.textVisible === undefined ? null : encounter.textVisible ? 1 : 0,
				JSON.stringify(encounter.detail ?? {}),
				encounter.at,
				deviceId,
				nextDeviceSeq(this.db, deviceId)
			]
		);
	}

	/** The latest sessions and what happened in them, newest first, for Diagnostics. */
	studyOverview(timeZone: string, now = new Date(), dayEndHour = 0): StudyOverview {
		const recent = queryRows(
			this.db,
			`SELECT kind, at, detail FROM encounter
			WHERE kind IN ('study-time','review') AND at >= ?
			AND (session_id IS NULL OR session_id NOT IN (${WITHDRAWN}))`,
			[new Date(now.getTime() - 9 * 86400000).toISOString()]
		).map((row) => ({
			kind: String(row.kind),
			at: String(row.at),
			detail: JSON.parse(String(row.detail))
		}));
		const sessions: StudySession[] = queryRows(
			this.db,
			`SELECT s.id, s.document_id, s.modality, s.started_at, d.title, d.removed_at,
			MAX(CASE WHEN e.kind NOT IN ('attention','engagement','withdrawn') THEN e.at END) AS last_at,
			SUM(CASE WHEN e.kind='study-time' THEN json_extract(e.detail,'$.durationMs') ELSE 0 END) AS activity_ms,
			SUM(CASE WHEN e.kind='played' THEN MAX(0,json_extract(e.detail,'$.toMs')-e.media_ms) ELSE 0 END) AS played_ms,
			MAX(CASE WHEN e.kind='session-end' THEN 1 ELSE 0 END) AS ended,
			(SELECT detail FROM encounter a WHERE a.session_id=s.id AND a.kind='attention' ORDER BY a.device_id DESC,a.device_seq DESC LIMIT 1) AS answer,
			(SELECT detail FROM encounter g WHERE g.session_id=s.id AND g.kind='engagement' ORDER BY g.device_id DESC,g.device_seq DESC LIMIT 1) AS engagement
			FROM session s JOIN document d ON d.id=s.document_id JOIN encounter e ON e.session_id=s.id
			WHERE s.id NOT IN (${WITHDRAWN}) GROUP BY s.id
			HAVING activity_ms >= 30000 OR played_ms >= 30000 OR ended=1 OR answer IS NOT NULL OR engagement IS NOT NULL
			ORDER BY last_at DESC`
		).map((row) => ({
			id: Number(row.id),
			documentId: Number(row.document_id),
			title: String(row.title),
			modality: String(row.modality),
			startedAt: String(row.started_at),
			lastAt: String(row.last_at),
			activityMs: Number(row.activity_ms),
			ended: row.ended === 1,
			answered: row.answer !== null,
			answer: row.answer === null ? null : JSON.parse(String(row.answer)).answer,
			engagement: row.engagement === null ? null : engagementOf(String(row.engagement)),
			available: row.removed_at === null
		}));
		const resume = sessions.find((s) => s.available);
		return {
			week: studyWeek(recent, timeZone, now, dayEndHour),
			sessions,
			resume: resume
				? { documentId: resume.documentId, title: resume.title, modality: resume.modality }
				: null
		};
	}

	recentEncounters(sessions = 3): RecentSession[] {
		return queryRows(
			this.db,
			`SELECT s.id, s.modality, s.started_at, d.title FROM session s
       JOIN document d ON d.id = s.document_id
       ORDER BY s.device_seq DESC LIMIT ?`,
			[sessions]
		).map((session) => ({
			title: String(session.title),
			modality: String(session.modality),
			startedAt: String(session.started_at),
			encounters: queryRows(
				this.db,
				`SELECT e.kind, l.surface, e.media_ms, e.speed, e.text_visible, e.detail, e.at
         FROM encounter e LEFT JOIN lexeme l ON l.id = e.lexeme_id
         WHERE e.session_id = ? ORDER BY e.device_seq`,
				[session.id]
			).map((row) => ({
				kind: String(row.kind),
				word: row.surface === null ? undefined : String(row.surface),
				mediaMs: row.media_ms === null ? undefined : Number(row.media_ms),
				speed: row.speed === null ? undefined : Number(row.speed),
				textVisible: row.text_visible === null ? undefined : row.text_visible === 1,
				detail: String(row.detail),
				at: String(row.at)
			}))
		}));
	}

	/**
	 * Keep the FSRS parameters an Anki import brought, unless they are the ones kept already. They
	 * live in the history, not in a setting, because every memory is recomputed from the history.
	 */
	private recordParameters(parameters: FsrsParameters, importId: string): boolean {
		const latest = queryRows(
			this.db,
			`SELECT detail FROM encounter WHERE kind = 'anki-parameters'
       ORDER BY at DESC, device_id DESC, device_seq DESC LIMIT 1`
		)[0];
		const kept = latest && (JSON.parse(String(latest.detail)) as FsrsParameters);
		const same =
			kept &&
			kept.preset === parameters.preset &&
			kept.retention === parameters.retention &&
			JSON.stringify(kept.weights) === JSON.stringify(parameters.weights);
		if (same) return false;
		this.appendEncounter(null, {
			kind: 'anki-parameters',
			at: new Date().toISOString(),
			detail: { ...parameters, importId }
		});
		return true;
	}

	/**
	 * Bring the reader's Anki words in (spec 006, ADR-0024): each word's Anki level as an ordinary
	 * judgment tagged with its import, in one transaction. What to write for each word is decided by
	 * `planImport`: never over the reader's own judgment, nothing for a word Anki has not changed.
	 */
	importAnki(file: AnkiExport): { set: number; keptOwn: string[]; unchanged: number } {
		return transact(this.db, () => {
			const plan = this.planAnki(file);
			// First, so the words below are computed under the parameters this import brought.
			const refitted = file.parameters
				? this.recordParameters(file.parameters, file.exportedAt)
				: false;
			const deviceId = deviceIdOf(this.db);
			const assertedAt = new Date().toISOString();
			for (const { word, level, provenance } of plan.set) {
				const entry = assertion({
					lexemeId: this.findOrCreateLexeme('zh', word),
					asserted: level,
					deviceId,
					deviceSeq: nextDeviceSeq(this.db, deviceId),
					assertedAt,
					provenance
				});
				this.appendEvent(entry);
				this.projectEntry(entry);
			}
			// New parameters change every word's memory, not only the words this import set.
			if (refitted) this.recomputeMemory(this.wordsWithHistory());
			return { set: plan.set.length, keptOwn: plan.keptOwn, unchanged: plan.unchanged };
		});
	}

	/** What `importAnki` would do, writing nothing: the preview the reader checks first (FR-010). */
	previewAnki(file: AnkiExport): { set: number; keptOwn: string[]; unchanged: number } {
		const plan = this.planAnki(file);
		return { set: plan.set.length, keptOwn: plan.keptOwn, unchanged: plan.unchanged };
	}

	/** Anki imports that still decide some word's state, newest first, with how many words each. */
	ankiImports(): { id: string; words: number }[] {
		const counts = new Map<string, number>();
		for (const row of queryRows(
			this.db,
			"SELECT provenance FROM word_state WHERE provenance LIKE 'anki %'"
		)) {
			const id = ankiImportOf(String(row.provenance))!;
			counts.set(id, (counts.get(id) ?? 0) + 1);
		}
		return [...counts].map(([id, words]) => ({ id, words })).sort((a, b) => (a.id < b.id ? 1 : -1));
	}

	private planAnki(file: AnkiExport) {
		const current = new Map(
			queryRows(
				this.db,
				`SELECT l.surface, s.state, s.provenance
             FROM word_state s JOIN lexeme l ON l.id = s.lexeme_id
            WHERE l.language = 'zh'`
			).map((row) => [
				String(row.surface),
				{ state: String(row.state), provenance: String(row.provenance) }
			])
		);
		return planImport(file, (word) => current.get(word));
	}

	/**
	 * Take an Anki import back (spec 006, FR-008): each word whose state is from that import gets the
	 * state it had just before the import, with that state's provenance, or a retraction if it had
	 * none. Appended, never deleted. Words the reader or a later import has changed since are left.
	 * Returns how many words it changed.
	 */
	undoAnkiImport(importId: string): number {
		return transact(this.db, () => {
			const history = inHistoryOrder(this.readHistory());
			const current = projectStates(history);
			const deviceId = deviceIdOf(this.db);
			const assertedAt = new Date().toISOString();
			let changed = 0;
			for (const [lexemeId, state] of current) {
				if (ankiImportOf(state.provenance) !== importId) continue;
				const own = history.filter((entry) => entry.lexemeId === lexemeId);
				const first = own.findIndex((entry) => ankiImportOf(entry.provenance) === importId);
				const before = projectStates(own.slice(0, first)).get(lexemeId);
				const entry = assertion({
					lexemeId,
					asserted: before?.state ?? RETRACTED,
					deviceId,
					deviceSeq: nextDeviceSeq(this.db, deviceId),
					assertedAt,
					provenance: before?.provenance ?? `anki ${importId} undo`
				});
				this.appendEvent(entry);
				this.projectEntry(entry);
				changed++;
			}
			return changed;
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

	/** Supplementary Anki context import never changes scheduling or creates reading evidence. */
	importCardExamples(values: unknown[]): number {
		if (!Array.isArray(values) || values.length > 30000) throw new Error('Invalid examples list.');
		const examples = values.map(checkedExample);
		return transact(this.db, () => {
			const latest = new Map<string, string>();
			for (const row of queryRows(
				this.db,
				"SELECT detail FROM encounter WHERE kind='anki-example' ORDER BY device_id,device_seq"
			)) {
				const data = JSON.parse(String(row.detail)) as AnkiExample;
				latest.set(data.key, JSON.stringify(data));
			}
			let count = 0;
			for (const example of examples) {
				const json = JSON.stringify(example);
				if (latest.get(example.key) === json) continue;
				this.appendEncounter(null, {
					kind: 'anki-example',
					at: new Date().toISOString(),
					lexemeId: this.findOrCreateLexeme('zh', example.word),
					detail: { ...example }
				});
				latest.set(example.key, json);
				count++;
			}
			return count;
		});
	}

	private ankiExample(lexemeId: LexemeId): CardSentence | undefined {
		const row = queryRows(
			this.db,
			"SELECT detail FROM encounter WHERE kind='anki-example' AND lexeme_id=? ORDER BY device_id DESC,device_seq DESC LIMIT 1",
			[lexemeId]
		)[0];
		if (!row) return;
		const e = checkedExample(JSON.parse(String(row.detail)));
		const wordFrom = [...e.text.slice(0, e.text.indexOf(e.word))].length;
		return {
			source: 'anki',
			sourceTitle: `Anki · ${e.profile}`,
			sourceKey: `anki:${e.key}`,
			available: true,
			text: e.text,
			from: 0,
			to: [...e.text].length,
			wordFrom,
			wordTo: wordFrom + [...e.word].length,
			line: 0,
			translation: e.translation,
			wordAudio: e.wordAudio,
			sentenceAudio: e.sentenceAudio
		};
	}

	/** Only retained, unwithdrawn encounter ranges qualify as a familiar Reader example. */
	cardSentence(lexemeId: LexemeId): CardSentence | undefined {
		const occurrences = queryRows(
			this.db,
			`SELECT t.document_id,t.start,t.end FROM token t
          WHERE t.lexeme_id=? AND ${ENCOUNTERED_TOKEN} ORDER BY t.document_id,t.start`,
			[lexemeId]
		).map((row) => ({
			documentId: Number(row.document_id),
			start: Number(row.start),
			end: Number(row.end)
		}));
		if (!occurrences.length) return this.ankiExample(lexemeId);
		const at = (d: unknown, o: unknown) =>
			occurrences.findIndex((v) => v.documentId === Number(d) && v.start === Number(o));
		const last = queryRows(
			this.db,
			`SELECT document_id,from_offset FROM encounter WHERE lexeme_id=? AND kind='review' ORDER BY device_id DESC,device_seq DESC LIMIT 1`,
			[lexemeId]
		)[0];
		const first = queryRows(
			this.db,
			`SELECT document_id,from_offset FROM encounter WHERE lexeme_id=? AND kind='lookup' AND (session_id IS NULL OR session_id NOT IN (${WITHDRAWN})) ORDER BY device_id,device_seq LIMIT 1`,
			[lexemeId]
		)[0];
		const chosen = last
			? (Math.max(at(last.document_id, last.from_offset), -1) + 1) % occurrences.length
			: first
				? Math.max(at(first.document_id, first.from_offset), 0)
				: 0;
		const occurrence = occurrences[chosen];
		const doc = queryRows(this.db, 'SELECT raw_content,title,removed_at FROM document WHERE id=?', [
			occurrence.documentId
		])[0];
		const chars = codePointsOf(String(doc.raw_content));
		let from = occurrence.start,
			to = occurrence.end;
		while (from > 0 && chars[from - 1] !== '\n' && !SENTENCE_ENDS.has(chars[from - 1])) from--;
		while (to < chars.length && chars[to] !== '\n' && !SENTENCE_ENDS.has(chars[to - 1])) to++;
		let lineFrom = from,
			lineTo = to;
		while (lineFrom > 0 && chars[lineFrom - 1] !== '\n') lineFrom--;
		while (lineTo < chars.length && chars[lineTo] !== '\n') lineTo++;
		return {
			source: 'reader',
			sourceTitle: String(doc.title),
			sourceKey: `reader:${occurrence.documentId}:${occurrence.start}`,
			available: doc.removed_at === null,
			documentId: occurrence.documentId,
			from,
			to,
			text: chars.slice(from, to).join(''),
			wordFrom: occurrence.start - from,
			wordTo: occurrence.end - from,
			line: chars.slice(0, occurrence.start).filter((c) => c === '\n').length,
			lineText: chars.slice(lineFrom, lineTo).join(''),
			lineFrom,
			wordAudio: this.ankiExample(lexemeId)?.wordAudio
		};
	}

	/** Today's reading cards in the order to show them (research R8), with each card's word. */
	cardsToday(cap: number, now: Date = new Date()): CardsToday {
		const rows = queryRows(
			this.db,
			`SELECT m.*, l.surface FROM memory m JOIN lexeme l ON l.id = m.lexeme_id
       WHERE m.skill = 'reading' AND m.card = 1`
		);
		const eligible = new Set(
			queryRows(
				this.db,
				`SELECT DISTINCT t.lexeme_id FROM token t WHERE ${ENCOUNTERED_TOKEN}
          UNION SELECT lexeme_id FROM encounter WHERE kind='anki-example' AND lexeme_id IS NOT NULL`
			).map((row) => Number(row.lexeme_id))
		);
		const readyRows = rows.filter((row) => eligible.has(Number(row.lexeme_id)));
		const frequency = new Map(
			queryRows(
				this.db,
				`SELECT t.lexeme_id, COUNT(*) AS n FROM token t
         JOIN memory m ON m.lexeme_id = t.lexeme_id AND m.skill = 'reading' AND m.card = 1
         GROUP BY t.lexeme_id`
			).map((row) => [Number(row.lexeme_id), Number(row.n)])
		);
		const midnight = new Date(now);
		midnight.setHours(0, 0, 0, 0);
		const firstReviewsToday = Number(
			queryRows(
				this.db,
				`SELECT COUNT(*) AS n FROM (
           SELECT MIN(at) AS first FROM encounter WHERE kind = 'review' GROUP BY lexeme_id
         ) WHERE first >= ?`,
				[midnight.toISOString()]
			)[0].n
		);
		const queue = cardQueue(
			readyRows.map((row) => ({ lexemeId: Number(row.lexeme_id), memory: memoryFromRow(row) })),
			{ frequency, firstReviewsToday, cap, now }
		);
		return {
			queue,
			words: Object.fromEntries(rows.map((row) => [Number(row.lexeme_id), String(row.surface)])),
			counts: {
				due: queue.due.length,
				fresh: queue.fresh.length,
				awaitingContext: rows.length - readyRows.length
			}
		};
	}

	/**
	 * These words' memory in each skill, and the parameters today's recall is computed with
	 * (spec 007, research R7). Recall itself is not stored: it changes with the clock.
	 */
	getMemory(lexemeIds: LexemeId[]): {
		memory: Map<LexemeId, Partial<Record<Skill, Memory>>>;
		parameters?: FsrsParameters;
	} {
		const memory = new Map<LexemeId, Partial<Record<Skill, Memory>>>();
		const unique = [...new Set(lexemeIds)];
		if (unique.length > 0) {
			const rows = queryRows(
				this.db,
				`SELECT * FROM memory WHERE lexeme_id IN (${unique.map(() => '?').join(', ')})`,
				unique
			);
			for (const row of rows) {
				const id = Number(row.lexeme_id);
				const skills = memory.get(id) ?? {};
				skills[String(row.skill) as Skill] = memoryFromRow(row);
				memory.set(id, skills);
			}
		}
		return { memory, parameters: this.currentParameters() };
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
	 * Everything the reader earned, and the inputs their documents came from, as a copy's body
	 * (ADR-0020). One read transaction, so events and states agree. Media subtitles and metadata live
	 * outside the database and are added by the caller.
	 *
	 * Refuses when the stored states are not the replay of the log: that means the database
	 * disagrees with its own history, and a copy of it would carry the disagreement forward.
	 */
	exportBody(app: string, createdAt: string): CopyBody {
		return transact(this.db, () => {
			const surfaces = new Map(
				queryRows(this.db, 'SELECT id, language, surface FROM lexeme').map((row) => [
					Number(row.id),
					{ language: String(row.language), surface: String(row.surface) }
				])
			);
			const word = (lexemeId: LexemeId) => surfaces.get(lexemeId)!;
			const history = this.readHistory();

			const stored = queryRows(
				this.db,
				'SELECT lexeme_id, state, provenance, user_id FROM word_state'
			);
			const replayed = projectStates(history);
			const agrees =
				stored.length === replayed.size &&
				stored.every((row) => {
					const state = replayed.get(Number(row.lexeme_id));
					return state?.state === row.state && state.provenance === row.provenance;
				});
			if (!agrees) {
				throw new StorageFailure('the stored word states are not the replay of their history');
			}

			// One device in practice: `deviceIdOf` takes the first row unordered, which is only
			// unambiguous while there is one. A copy restores that device first either way.
			const devices = queryRows(this.db, 'SELECT id, next_seq FROM device').map((row) => ({
				id: String(row.id),
				nextSeq: Number(row.next_seq)
			}));

			return {
				format: FORMAT,
				app,
				createdAt,
				writer: devices[0]?.id ?? '',
				devices,
				documents: queryRows(
					this.db,
					`SELECT id, title, language, content_type, raw_content, created_at, removed_at
           FROM document ORDER BY id`
				).map((row) => ({
					id: Number(row.id),
					title: String(row.title),
					language: String(row.language),
					contentType: String(row.content_type),
					rawContent: String(row.raw_content),
					createdAt: String(row.created_at),
					...(row.removed_at === null ? {} : { removedAt: String(row.removed_at) })
				})),
				events: history.map((entry) => ({
					deviceId: entry.deviceId,
					deviceSeq: entry.deviceSeq,
					...word(entry.lexemeId),
					asserted: entry.asserted,
					assertedAt: entry.assertedAt,
					provenance: entry.provenance,
					userId: entry.userId,
					...(entry.occurrence
						? {
								documentId: entry.occurrence.documentId,
								from: entry.occurrence.fromOffset,
								to: entry.occurrence.toOffset,
								...(entry.occurrence.observedPronunciation === undefined
									? {}
									: { observedPronunciation: entry.occurrence.observedPronunciation })
							}
						: {})
				})),
				states: [...replayed.values()]
					.map((state) => ({
						...word(state.lexemeId),
						state: state.state,
						provenance: state.provenance,
						userId: state.userId
					}))
					.sort((a, b) =>
						a.language === b.language
							? a.surface < b.surface
								? -1
								: a.surface > b.surface
									? 1
									: 0
							: a.language < b.language
								? -1
								: 1
					),
				...this.exportEncounters(word),
				corrections: this.readCorrections().map((correction) => ({
					deviceId: correction.deviceId,
					deviceSeq: correction.deviceSeq,
					language: correction.language,
					form: correction.form,
					...(correction.parts ? { parts: correction.parts } : {}),
					madeAt: correction.madeAt,
					userId: correction.userId,
					...(correction.occurrence
						? {
								documentId: correction.occurrence.documentId,
								from: correction.occurrence.fromOffset,
								to: correction.occurrence.toOffset
							}
						: {})
				}))
			};
		});
	}

	/** Sessions and encounters for a copy (format 2), in history order, words by surface. */
	private exportEncounters(word: (lexemeId: LexemeId) => { language: string; surface: string }) {
		const optional = <T>(key: string, value: T | null | undefined) =>
			value === null || value === undefined ? {} : { [key]: value };
		const sessions = queryRows(
			this.db,
			`SELECT device_id, device_seq, document_id, modality, started_at, user_id
       FROM session ORDER BY device_id, device_seq`
		).map((row) => ({
			deviceId: String(row.device_id),
			deviceSeq: Number(row.device_seq),
			documentId: Number(row.document_id),
			modality: String(row.modality),
			startedAt: String(row.started_at),
			userId: Number(row.user_id)
		}));
		const encounters = queryRows(
			this.db,
			`SELECT e.*, s.device_id AS s_device, s.device_seq AS s_seq
       FROM encounter e LEFT JOIN session s ON s.id = e.session_id
       ORDER BY e.device_id, e.device_seq`
		).map((row) => ({
			deviceId: String(row.device_id),
			deviceSeq: Number(row.device_seq),
			...(row.s_device === null
				? {}
				: { session: { deviceId: String(row.s_device), deviceSeq: Number(row.s_seq) } }),
			kind: String(row.kind),
			...(row.lexeme_id === null ? {} : word(Number(row.lexeme_id))),
			...optional('documentId', row.document_id === null ? null : Number(row.document_id)),
			...optional('from', row.from_offset === null ? null : Number(row.from_offset)),
			...optional('to', row.to_offset === null ? null : Number(row.to_offset)),
			...optional('mediaMs', row.media_ms === null ? null : Number(row.media_ms)),
			...optional('speed', row.speed === null ? null : Number(row.speed)),
			...optional('textVisible', row.text_visible === null ? null : row.text_visible === 1),
			detail: JSON.parse(String(row.detail)),
			at: String(row.at),
			userId: Number(row.user_id)
		}));
		return { sessions, encounters };
	}

	/**
	 * Put a copy's earned data back, all or nothing (copy-format.md, Restoring).
	 *
	 * Refuses a library with any mark in it (FR-010). Documents are renumbered, since a library may
	 * already hold some, and events follow them. The device that wrote the copy carries on, so new
	 * marks continue its sequence. States are not taken from the copy but replayed from the restored
	 * log, then required to equal the copy's: that is FR-007's own definition, checked on every
	 * restore. Documents come back without tokens, stamped so that opening one re-derives it.
	 *
	 * Returns the new id of each copied document.
	 */
	restoreCopy(copy: CopyBody): Map<DocumentId, DocumentId> {
		const earned = queryRows(
			this.db,
			`SELECT (SELECT COUNT(*) FROM word_state) + (SELECT COUNT(*) FROM status_event)
            + (SELECT COUNT(*) FROM session) + (SELECT COUNT(*) FROM correction_event) AS n`
		);
		if (Number(earned[0].n) > 0) {
			throw new CopyRejected(
				'not-empty',
				'This library already has marked words or reading history, so restoring could overwrite newer work.'
			);
		}
		const documentIds = new Set(copy.documents.map((document) => document.id));
		const deviceIds = new Set(copy.devices.map((device) => device.id));
		const dangling = copy.events.find(
			(event) =>
				!deviceIds.has(event.deviceId) ||
				(event.documentId !== undefined && !documentIds.has(event.documentId))
		);
		const sessionKeys = new Set(
			copy.sessions.map((session) => `${session.deviceId}#${session.deviceSeq}`)
		);
		const danglingEncounter =
			copy.sessions.some(
				(session) => !deviceIds.has(session.deviceId) || !documentIds.has(session.documentId)
			) ||
			copy.encounters.some(
				(encounter) =>
					!deviceIds.has(encounter.deviceId) ||
					(encounter.documentId !== undefined && !documentIds.has(encounter.documentId)) ||
					(encounter.session !== undefined &&
						!sessionKeys.has(`${encounter.session.deviceId}#${encounter.session.deviceSeq}`))
			) ||
			copy.corrections.some(
				(correction) =>
					!deviceIds.has(correction.deviceId) ||
					(correction.documentId !== undefined && !documentIds.has(correction.documentId))
			);
		if (dangling || danglingEncounter) {
			throw new CopyRejected('references', 'The copy is inconsistent: a mark points at nothing.');
		}

		return transact(this.db, () => {
			run(this.db, 'DELETE FROM device');
			const writerFirst = [...copy.devices].sort(
				(a, b) => Number(b.id === copy.writer) - Number(a.id === copy.writer)
			);
			for (const device of writerFirst) {
				run(this.db, 'INSERT INTO device (id, next_seq) VALUES (?, ?)', [
					device.id,
					device.nextSeq
				]);
			}

			const renumbered = new Map<DocumentId, DocumentId>();
			for (const document of copy.documents) {
				run(
					this.db,
					`INSERT INTO document
             (raw_content, content_type, language, analyzer, analyzer_version, title, created_at)
           VALUES (?, ?, ?, 'restored', '0', ?, ?)`,
					[
						document.rawContent,
						document.contentType,
						document.language,
						document.title,
						document.createdAt
					]
				);
				renumbered.set(document.id, lastInsertId(this.db));
				if (document.removedAt !== undefined)
					run(this.db, 'UPDATE document SET removed_at = ? WHERE id = ?', [
						document.removedAt,
						lastInsertId(this.db)
					]);
			}

			this.restoreEncounters(copy, renumbered);

			for (const correction of copy.corrections) {
				run(
					this.db,
					`INSERT INTO correction_event
             (language, form, parts, made_at, device_id, device_seq, document_id, from_offset,
              to_offset, user_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
					[
						correction.language,
						correction.form,
						correction.parts ? JSON.stringify(correction.parts) : null,
						correction.madeAt,
						correction.deviceId,
						correction.deviceSeq,
						correction.documentId === undefined ? null : renumbered.get(correction.documentId)!,
						correction.from ?? null,
						correction.to ?? null,
						correction.userId
					]
				);
			}

			for (const event of copy.events) {
				this.appendEvent(
					assertion({
						lexemeId: this.findOrCreateLexeme(event.language, event.surface),
						asserted: event.asserted,
						assertedAt: event.assertedAt,
						deviceId: event.deviceId,
						deviceSeq: event.deviceSeq,
						provenance: event.provenance,
						userId: event.userId,
						occurrence:
							event.documentId === undefined
								? undefined
								: {
										documentId: renumbered.get(event.documentId)!,
										fromOffset: event.from!,
										toOffset: event.to!,
										...(event.observedPronunciation === undefined
											? {}
											: { observedPronunciation: event.observedPronunciation })
									}
					})
				);
			}

			const replayed = projectStates(this.readHistory());
			for (const state of replayed.values()) this.writeProjectedState(state);
			const expected = new Map(
				copy.states.map((state) => [`${state.language}\u0000${state.surface}`, state])
			);
			const matches =
				replayed.size === expected.size &&
				[...replayed.values()].every((state) => {
					const { language, surface } = queryRows(
						this.db,
						'SELECT language, surface FROM lexeme WHERE id = ?',
						[state.lexemeId]
					)[0];
					const want = expected.get(`${String(language)}\u0000${String(surface)}`);
					return want?.state === state.state && want.provenance === state.provenance;
				});
			if (!matches) {
				throw new CopyRejected(
					'states',
					'The copy is inconsistent: its marks do not match its history.'
				);
			}
			// Memory is derived and never copied: rebuilt from what was just restored.
			run(this.db, 'DELETE FROM memory');
			this.recomputeMemory(this.wordsWithHistory());
			return renumbered;
		});
	}

	/** Put a copy's sessions and encounters back exactly, sequence numbers included (format 2). */
	private restoreEncounters(copy: CopyBody, renumbered: Map<DocumentId, DocumentId>): void {
		const sessions = new Map<string, number>();
		for (const session of copy.sessions) {
			run(
				this.db,
				`INSERT INTO session (document_id, modality, started_at, device_id, device_seq, user_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
				[
					renumbered.get(session.documentId)!,
					session.modality,
					session.startedAt,
					session.deviceId,
					session.deviceSeq,
					session.userId
				]
			);
			sessions.set(`${session.deviceId}#${session.deviceSeq}`, lastInsertId(this.db));
		}
		for (const encounter of copy.encounters) {
			run(
				this.db,
				`INSERT INTO encounter
           (session_id, kind, lexeme_id, document_id, from_offset, to_offset, media_ms, speed,
            text_visible, detail, at, device_id, device_seq, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					encounter.session
						? sessions.get(`${encounter.session.deviceId}#${encounter.session.deviceSeq}`)!
						: null,
					encounter.kind,
					encounter.surface === undefined
						? null
						: this.findOrCreateLexeme(encounter.language!, encounter.surface),
					encounter.documentId === undefined ? null : renumbered.get(encounter.documentId)!,
					encounter.from ?? null,
					encounter.to ?? null,
					encounter.mediaMs ?? null,
					encounter.speed ?? null,
					encounter.textVisible === undefined ? null : encounter.textVisible ? 1 : 0,
					JSON.stringify(encounter.detail),
					encounter.at,
					encounter.deviceId,
					encounter.deviceSeq,
					encounter.userId
				]
			);
		}
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
