import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Repository, ENCOUNTERED_WORDS } from '../../src/lib/storage/repository';
import { queryRows } from '../../src/lib/storage/db';
import { characterSplitter } from '../../src/lib/analyzer/character';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { textShares, wordCounts } from '../../src/lib/domain/shares';
import { scoreText, type ScoreStore } from '../../src/lib/content/find';
import { freshDatabase } from '../storage/support';

// Find videos (spec 015, FR-005, SC-002): a candidate is scored as an unsaved text, and must get
// exactly the figures the library would give the same text saved as a document. Nothing written.

const LIBRARY = ['我', '看', '书', '你', '他', '好'];
const UNSEEN = ['新', '词'];
const NOW = new Date('2026-12-01T00:00:00Z');

const libraryArb = fc.record({
	texts: fc.array(fc.array(fc.constantFrom(...LIBRARY), { minLength: 1, maxLength: 8 }), {
		minLength: 1,
		maxLength: 3
	}),
	marks: fc.array(
		fc.record({
			word: fc.nat(),
			state: fc.constantFrom('known', 'learning', 'ignored', 'anki-mature')
		}),
		{ maxLength: 4 }
	),
	reviews: fc.array(fc.record({ word: fc.nat(), grade: fc.integer({ min: 1, max: 4 }) }), {
		maxLength: 4
	}),
	reads: fc.array(fc.record({ document: fc.nat(), from: fc.nat(), length: fc.nat({ max: 4 }) }), {
		maxLength: 3
	}),
	candidate: fc.array(fc.constantFrom(...LIBRARY, ...UNSEEN), { minLength: 1, maxLength: 12 })
});

function store(repository: Repository): ScoreStore {
	return {
		wordsByForm: async (language, forms) => repository.wordsByForm(language, forms),
		getStates: async (ids) => repository.getStates(ids),
		getMemory: async (ids) => repository.getMemory(ids)
	};
}

async function save(repository: Repository, text: string) {
	const tokens = resolveTokens(text, await characterSplitter.analyze(text), characterSplitter);
	return repository.saveDocument(
		{ rawContent: text, contentType: 'text/plain', language: 'zh', title: text },
		tokens,
		stampOf(characterSplitter)
	);
}

describe('a candidate scored as unsaved text', () => {
	it('gets the figures the same text saved as a document gets, and writes nothing', async () => {
		await fc.assert(
			fc.asyncProperty(libraryArb, async (library) => {
				const db = await freshDatabase();
				const repository = new Repository(db);
				const ids: number[] = [];
				for (const chars of library.texts) ids.push(await save(repository, chars.join('')));
				const words = ids.flatMap((id) =>
					repository
						.getDocument(id)
						.tokens.filter((t) => t.isWord)
						.map((token) => ({ ...token, documentId: id }))
				);
				for (const mark of library.marks) {
					const token = words[mark.word % words.length];
					repository.assertState(token.lexemeId!, mark.state, {
						documentId: token.documentId,
						fromOffset: token.start,
						toOffset: token.end
					});
				}
				library.reviews.forEach((review, i) => {
					const token = words[review.word % words.length];
					repository.recordReview(
						token.lexemeId!,
						review.grade,
						undefined,
						`2026-10-0${i + 1}T08:00:00Z`
					);
				});
				for (const read of library.reads) {
					const id = ids[read.document % ids.length];
					const length = [...repository.getDocument(id).rawContent].length;
					const from = read.from % length;
					repository.recordEncounters(repository.startSession(id, 'reading'), [
						{
							kind: 'read',
							at: '2026-10-10T08:00:00Z',
							documentId: id,
							fromOffset: from,
							toOffset: Math.min(length, from + read.length)
						}
					]);
				}
				const text = library.candidate.join('');
				const before = queryRows(
					db,
					`SELECT (SELECT count(*) FROM encounter) e, (SELECT count(*) FROM status_event) m,
					        (SELECT count(*) FROM document) d, (SELECT count(*) FROM lexeme) l`
				)[0];

				const score = await scoreText(text, characterSplitter, store(repository), NOW);

				const after = queryRows(
					db,
					`SELECT (SELECT count(*) FROM encounter) e, (SELECT count(*) FROM status_event) m,
					        (SELECT count(*) FROM document) d, (SELECT count(*) FROM lexeme) l`
				)[0];
				expect(after).toEqual(before);

				// The library's figures for the same text, saved.
				const saved = await save(repository, text);
				const occurrences = repository.wordOccurrences([saved]).get(saved) ?? new Map();
				const lexemes = [...occurrences.keys()];
				const states = repository.getStates(lexemes);
				const memory = repository.getMemory(lexemes);
				const shares = textShares(occurrences, states, memory.memory, NOW, memory.parameters);
				expect(score.known).toBe(shares?.known);
				const counts = wordCounts(
					occurrences,
					new Map(),
					states,
					memory.memory,
					NOW,
					memory.parameters
				);
				expect(score.due.length).toBe(counts.due);
				const met = new Set(queryRows(db, ENCOUNTERED_WORDS).map((row) => Number(row.lexeme_id)));
				const marked = new Set(
					queryRows(db, 'SELECT lexeme_id FROM status_event').map((r) => Number(r.lexeme_id))
				);
				const remembered = new Set(
					queryRows(db, 'SELECT lexeme_id FROM memory').map((r) => Number(r.lexeme_id))
				);
				const reviewed = new Set(
					queryRows(db, `SELECT lexeme_id FROM encounter WHERE kind = 'review'`).map((r) =>
						Number(r.lexeme_id)
					)
				);
				const neverMet = lexemes.filter(
					(id) => !met.has(id) && !marked.has(id) && !remembered.has(id) && !reviewed.has(id)
				);
				expect(score.neverMet).toBe(neverMet.length);
				db.close();
			}),
			{ numRuns: 60 }
		);
	});
});
