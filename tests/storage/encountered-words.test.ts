import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Repository, ENCOUNTERED_WORDS } from '../../src/lib/storage/repository';
import { queryRows } from '../../src/lib/storage/db';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import type { Encounter } from '../../src/lib/domain/encounter';
import { freshDatabase, pairwiseAnalyzer } from './support';

// The words met in the library, as the card queue had them: each token checked against every
// earlier encounter in its document. Took 9 s on the phone with 67,617 tokens (issue #1); kept here
// as the reference the faster query must agree with.
const WITHDRAWN = `SELECT session_id FROM encounter WHERE kind = 'withdrawn' AND session_id IS NOT NULL`;
const REFERENCE = `SELECT DISTINCT t.lexeme_id FROM token t WHERE EXISTS (SELECT 1 FROM encounter e
  WHERE e.document_id=t.document_id AND e.from_offset<=t.start AND e.to_offset>=t.end
  AND e.kind IN ('read','played','lookup','check')
  AND (e.session_id IS NULL OR e.session_id NOT IN (${WITHDRAWN})))
  UNION SELECT lexeme_id FROM encounter WHERE kind='anki-example' AND lexeme_id IS NOT NULL`;

const KINDS = ['read', 'played', 'lookup', 'check', 'review', 'tap-undone'] as const;

const sessionArb = fc.record({
	document: fc.nat(),
	withdrawn: fc.boolean(),
	encounters: fc.array(
		fc.record({ kind: fc.constantFrom(...KINDS), from: fc.nat(), length: fc.nat({ max: 12 }) }),
		{ size: 'max', maxLength: 12 }
	)
});

describe('the words met in the library', { timeout: 60_000 }, () => {
	it('are the same as checking every token against every encounter', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.stringMatching(/^[我你他看书好人大]{2,24}$/), { minLength: 1, maxLength: 3 }),
				fc.array(sessionArb, { size: 'max', maxLength: 8 }),
				async (texts, sessions) => {
					const db = await freshDatabase();
					const repository = new Repository(db);
					const ids: number[] = [];
					for (const text of texts) {
						const tokens = resolveTokens(
							text,
							await pairwiseAnalyzer.analyze(text),
							pairwiseAnalyzer
						);
						ids.push(
							repository.saveDocument(
								{ rawContent: text, contentType: 'text/plain', language: 'zh', title: text },
								tokens,
								stampOf(pairwiseAnalyzer)
							)
						);
					}
					for (const session of sessions) {
						const index = session.document % ids.length;
						const document = repository.getDocument(ids[index]);
						const length = [...texts[index]].length;
						const word = document.tokens.find((t) => t.lexemeId !== undefined)!.lexemeId!;
						const id = repository.startSession(document.id, 'reading');
						const encounters: Encounter[] = session.encounters.map(({ kind, from, length: n }) => {
							const fromOffset = from % (length + 1);
							const toOffset = Math.min(length, fromOffset + n);
							return {
								kind,
								at: '2026-10-05T10:00:00Z',
								documentId: document.id,
								fromOffset,
								toOffset,
								lexemeId: word,
								mediaMs: 0,
								detail: { toMs: 1000, skill: 'reading', grade: 3 }
							};
						});
						if (encounters.length > 0) repository.recordEncounters(id, encounters);
						if (session.withdrawn) repository.withdrawSession(id, 'test');
					}
					const words = (sql: string) =>
						queryRows(db, sql)
							.map((row) => Number(row.lexeme_id))
							.sort((a, b) => a - b);
					expect(words(ENCOUNTERED_WORDS)).toEqual(words(REFERENCE));
					db.close();
				}
			),
			{ numRuns: 150 }
		);
	});
});
