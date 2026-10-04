import { describe, expect, it } from 'vitest';
import { default_w } from 'ts-fsrs';
import { Repository } from '../../src/lib/storage/repository';
import { queryRows, run, type Database } from '../../src/lib/storage/db';
import { sweepStaleMemory } from '../../src/lib/storage/sweep';
import { baselineSet, idOf, type ParameterSet } from '../../src/lib/domain/fit';
import { open, seal } from '../../src/lib/backup/format';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';

// Applying a fitted set and returning from it (spec 013 Story 3, FR-009, FR-010, FR-012): the
// history never changes, only which set memory is computed under, and returning is exact.

const day = (n: number) => new Date(Date.UTC(2026, 9, n, 10)).toISOString();

async function reader() {
	const db = await freshDatabase();
	const repository = new Repository(db);
	const [documentId] = await buildHistory(repository, ['我看书你好将来'], []);
	const words = repository.getDocument(documentId).tokens.filter((t) => t.isWord);
	const session = repository.startSession(documentId, 'reading');
	repository.recordEncounters(session, [
		{ kind: 'read', at: day(1), documentId, fromOffset: 0, toOffset: 7 },
		{
			kind: 'lookup',
			at: day(1),
			documentId,
			lexemeId: words[0].lexemeId!,
			fromOffset: words[0].start,
			toOffset: words[0].end
		},
		{ kind: 'attention', at: day(1), detail: { answer: 'all' } }
	]);
	repository.recordReview(words[0].lexemeId!, 3, undefined, day(5));
	const settle = () =>
		sweepStaleMemory(
			{
				staleMemory: async (limit) => repository.staleMemory(limit),
				refreshMemory: async (ids) => repository.refreshMemory(ids)
			},
			() => true
		);
	return { db, repository, settle };
}

const memory = (db: Database) =>
	queryRows(db, 'SELECT * FROM memory ORDER BY lexeme_id, skill').map((r) => JSON.stringify(r));
const history = (db: Database) =>
	['status_event', 'session', 'document'].map((t) => queryRows(db, `SELECT * FROM ${t}`));

/** A set the laptop fit could have made, against the set in force now. */
function fitted(comparedWith: string, applicable = true): ParameterSet & Record<string, unknown> {
	const base = baselineSet([...default_w], 0.9);
	const set = {
		model: base.model,
		weights: base.weights,
		strengths: { seenReading: 0.4, seenListening: 1, tapStability: 3 },
		falseSuccess: 0.1,
		falseFailure: 0.05,
		retention: 0.9
	};
	return {
		...set,
		id: idOf(set),
		comparedWith,
		report: { applicable, why: applicable ? 'predicted better' : 'did not predict better' }
	};
}

describe('a fitted set', () => {
	it('changes memory when applied, and returning restores it field for field (SC-004)', async () => {
		const { db, repository, settle } = await reader();
		const before = memory(db);
		const kept = history(db);
		const set = fitted(repository.parametersInForce().id);
		repository.applyParameters(set);
		await settle();
		expect(repository.parametersInForce().id).toBe(set.id);
		expect(memory(db)).not.toEqual(before);
		repository.returnToParameters(null);
		await settle();
		expect(memory(db)).toEqual(before);
		expect(history(db)).toEqual(kept);
		expect(
			queryRows(db, `SELECT COUNT(*) AS n FROM encounter WHERE kind = 'fsrs-activation'`)
		).toEqual([{ n: 2 }]);
	});

	it('is refused unless it predicted better, against the set in force, unaltered', async () => {
		const { repository } = await reader();
		const inForce = repository.parametersInForce().id;
		expect(() => repository.applyParameters(fitted(inForce, false))).toThrow(/predict/);
		expect(() => repository.applyParameters(fitted('someone-else'))).toThrow(/different set/);
		const altered = { ...fitted(inForce), falseSuccess: 0.3 };
		expect(() => repository.applyParameters(altered)).toThrow();
		expect(repository.parametersInForce().id).toBe(inForce);
	});

	it('can always be returned to, and the history lists every change', async () => {
		const { repository } = await reader();
		const first = fitted(repository.parametersInForce().id);
		repository.applyParameters(first);
		repository.returnToParameters(null);
		repository.returnToParameters(first.id);
		expect(repository.parametersInForce().id).toBe(first.id);
		expect(repository.parameterHistory().map((h) => [h.action, h.id])).toEqual([
			['rollback', first.id],
			['rollback', baselineSet([...default_w], 0.9).id],
			['apply', first.id]
		]);
	});

	it('in force is the latest change by time, whichever device made it', async () => {
		const { db, repository } = await reader();
		const set = fitted(repository.parametersInForce().id);
		repository.applyParameters(set);
		const at = queryRows(db, `SELECT at FROM encounter WHERE kind = 'fsrs-activation'`)[0].at;
		// An earlier return to the Anki weights, made on a device whose id sorts before any other.
		run(db, `INSERT INTO device (id, next_seq) VALUES ('00000000-other', 2)`);
		run(
			db,
			`INSERT INTO encounter (kind, detail, at, device_id, device_seq)
       VALUES ('fsrs-activation', ?, ?, '00000000-other', 1)`,
			[
				JSON.stringify({ action: 'rollback', set: null }),
				new Date(Date.parse(String(at)) - 60_000).toISOString()
			]
		);
		expect(repository.parametersInForce().id).toBe(set.id);
	});

	it('stays in force through a backup and its restore', async () => {
		const { repository } = await reader();
		const set = fitted(repository.parametersInForce().id);
		repository.applyParameters(set);
		const copy = repository.exportBody('test', day(9));
		const other = await freshDatabase();
		try {
			const restored = new Repository(other);
			restored.restoreCopy(await open(JSON.stringify(await seal(copy))));
			expect(restored.parametersInForce().id).toBe(set.id);
		} finally {
			other.close();
		}
	});
});
