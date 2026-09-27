import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Repository } from '../../src/lib/storage/repository';
import { queryRows } from '../../src/lib/storage/db';
import { freshDatabase } from './support';
import { buildHistory, dump } from '../backup/support';
import type { Encounter } from '../../src/lib/domain/encounter';

// The encounter log is earned and append-only (ADR-0027): a batch is all or nothing, rows are never
// changed, and encounters share the device counter with status events, giving one order.

const at = '2026-09-27T10:00:00.000Z';

async function library() {
	const db = await freshDatabase();
	const repository = new Repository(db);
	const [documentId] = await buildHistory(repository, ['我看书你好'], []);
	const word = repository.getDocument(documentId).tokens.find((token) => token.isWord)!;
	const lookup: Encounter = {
		kind: 'lookup',
		at,
		lexemeId: word.lexemeId,
		documentId,
		fromOffset: word.start,
		toOffset: word.end,
		mediaMs: 1200,
		speed: 0.75,
		textVisible: true
	};
	return { db, repository, documentId, word, lookup };
}

describe('recording encounters', () => {
	it('stores every field of an encounter as given, in a session', async () => {
		const { db, repository, documentId, lookup } = await library();
		const session = repository.startSession(documentId, 'media');

		repository.recordEncounters(session, [
			lookup,
			{ kind: 'attention', at, detail: { answer: 'all' } }
		]);

		const rows = queryRows(db, 'SELECT * FROM encounter ORDER BY device_seq');
		expect(rows).toHaveLength(2);
		expect(rows[0]).toMatchObject({
			session_id: session,
			kind: 'lookup',
			lexeme_id: lookup.lexemeId!,
			document_id: documentId,
			from_offset: lookup.fromOffset!,
			to_offset: lookup.toOffset!,
			media_ms: 1200,
			speed: 0.75,
			text_visible: 1,
			detail: '{}',
			at
		});
		expect(JSON.parse(String(rows[1].detail))).toEqual({ answer: 'all' });
		expect(queryRows(db, 'SELECT document_id, modality FROM session')).toEqual([
			{ document_id: documentId, modality: 'media' }
		]);
	});

	it('writes nothing of a batch when one encounter in it is refused', async () => {
		const { db, repository, documentId, lookup } = await library();
		const session = repository.startSession(documentId, 'reading');
		const before = dump(db);

		expect(() =>
			repository.recordEncounters(session, [lookup, { kind: 'review', at, detail: {} }])
		).toThrow();
		expect(dump(db)).toBe(before);
	});

	it('refuses encounters for a session that does not exist', async () => {
		const { repository, lookup } = await library();
		expect(() => repository.recordEncounters(999, [lookup])).toThrow();
	});

	it('only grows, and orders marks, sessions and encounters on one counter', async () => {
		await fc.assert(
			fc.asyncProperty(
				fc.array(fc.constantFrom('mark', 'session', 'batch'), { minLength: 1, maxLength: 12 }),
				fc.integer({ min: 1, max: 4 }),
				async (steps, batchSize) => {
					const { db, repository, documentId, word, lookup } = await library();
					let session = repository.startSession(documentId, 'reading');
					let previous: string[] = [];
					for (const step of steps) {
						if (step === 'mark') repository.assertState(word.lexemeId!, 'learning');
						if (step === 'session') session = repository.startSession(documentId, 'reading');
						if (step === 'batch')
							repository.recordEncounters(session, Array(batchSize).fill(lookup));

						const now = queryRows(db, 'SELECT * FROM encounter ORDER BY id').map((row) =>
							JSON.stringify(row)
						);
						expect(now.slice(0, previous.length)).toEqual(previous);
						previous = now;
					}
					const seqs = queryRows(
						db,
						`SELECT device_seq FROM status_event UNION ALL SELECT device_seq FROM session
             UNION ALL SELECT device_seq FROM encounter`
					).map((row) => Number(row.device_seq));
					expect(new Set(seqs).size).toBe(seqs.length);
					const order = queryRows(db, 'SELECT id FROM encounter ORDER BY device_seq');
					expect(order).toEqual(queryRows(db, 'SELECT id FROM encounter ORDER BY id'));
				}
			),
			{ numRuns: 30 }
		);
	});
});
