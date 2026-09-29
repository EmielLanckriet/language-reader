import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { Repository } from '../../src/lib/storage/repository';
import { queryRows, type Database } from '../../src/lib/storage/db';
import { parseAnkiExport } from '../../src/lib/domain/anki';
import { ruleKey } from '../../src/lib/domain/memory';
import { freshDatabase, pairwiseAnalyzer } from './support';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { sweepStaleMemory } from '../../src/lib/storage/sweep';
import { run } from '../../src/lib/storage/db';
import { buildHistory } from '../backup/support';

// Memory is derived (ADR-0027): every event that touches a word recomputes that word's rows in the
// same transaction, and rebuilding from nothing gives exactly the rows built up that way (SC-007).

const anki = parseAnkiExport(readFileSync('tests/fixtures/anki/anki-words-v2.json', 'utf8'));
const day = (n: number, hour = 10) => new Date(Date.UTC(2026, 9, n, hour)).toISOString();

async function library() {
	const db = await freshDatabase();
	const repository = new Repository(db);
	const [documentId] = await buildHistory(repository, ['我看书你好将来'], []);
	const words = repository.getDocument(documentId).tokens.filter((token) => token.isWord);
	const lookup = (i: number, at: string) => ({
		kind: 'lookup',
		at,
		lexemeId: words[i].lexemeId,
		documentId,
		fromOffset: words[i].start,
		toOffset: words[i].end
	});
	const read = (at: string) => ({ kind: 'read', at, documentId, fromOffset: 0, toOffset: 7 });
	return { db, repository, documentId, words, lookup, read };
}

const rows = (db: Database) =>
	queryRows(db, 'SELECT * FROM memory ORDER BY lexeme_id, skill').map((row) => JSON.stringify(row));

describe('memory kept with the history', () => {
	it('is made by a lookup, in the same write, as a card in both skills', async () => {
		const { db, repository, documentId, words, lookup } = await library();
		repository.recordEncounters(repository.startSession(documentId, 'reading'), [
			lookup(0, day(1))
		]);

		const memory = queryRows(db, 'SELECT * FROM memory ORDER BY skill');
		expect(memory.map((row) => [row.lexeme_id, row.skill, row.card, row.rule])).toEqual([
			[words[0].lexemeId!, 'listening', 0, ruleKey()],
			[words[0].lexemeId!, 'reading', 1, ruleKey()]
		]);
	});

	it('is recomputed for the words of a session when its attention answer arrives', async () => {
		const { db, repository, documentId, words, lookup, read } = await library();
		repository.recordEncounters(repository.startSession(documentId, 'reading'), [
			lookup(0, day(1))
		]);
		const before = queryRows(db, `SELECT reps FROM memory WHERE skill = 'reading'`)[0].reps;

		const later = repository.startSession(documentId, 'reading');
		repository.recordEncounters(later, [read(day(5))]);
		expect(queryRows(db, `SELECT reps FROM memory WHERE skill = 'reading'`)[0].reps).toBe(before);
		repository.recordEncounters(later, [
			{ kind: 'attention', at: day(5, 11), detail: { answer: 'all' } }
		]);

		expect(queryRows(db, `SELECT reps FROM memory WHERE skill = 'reading'`)[0].reps).toBe(
			Number(before) + 1
		);
		// Every word read past starts a memory (evidence-2), though only the looked-up one is a card.
		expect(queryRows(db, 'SELECT DISTINCT lexeme_id FROM memory ORDER BY lexeme_id')).toEqual(
			[...new Set(words.map((w) => w.lexemeId!))]
				.sort((a, b) => a - b)
				.map((id) => ({ lexeme_id: id }))
		);
		expect(
			queryRows(db, "SELECT lexeme_id FROM memory WHERE card = 1 AND skill = 'reading'")
		).toEqual([{ lexeme_id: words[0].lexemeId! }]);
	});

	it('credits only the words of the part that played, when a video was left halfway', async () => {
		const { db, repository, documentId, words } = await library();
		// 我看书 played, 你好将来 not: the reader stopped there and said they tapped every word.
		const half = words.find((w) => w.start >= 3)!.start;
		const session = repository.startSession(documentId, 'media');
		repository.recordEncounters(session, [
			{
				kind: 'played',
				at: day(5),
				documentId,
				fromOffset: 0,
				toOffset: half,
				mediaMs: 0,
				speed: 1,
				textVisible: true,
				detail: { toMs: 5000 }
			},
			{ kind: 'attention', at: day(5, 11), detail: { answer: 'all' } }
		]);

		const credited = queryRows(db, 'SELECT DISTINCT lexeme_id FROM memory').map((row) =>
			Number(row.lexeme_id)
		);
		const played = words.filter((w) => w.end <= half).map((w) => w.lexemeId!);
		const unplayed = words.filter((w) => w.start >= half).map((w) => w.lexemeId!);
		expect(new Set(credited)).toEqual(new Set(played));
		expect(unplayed.some((id) => credited.includes(id))).toBe(false);
	});

	it('says how far playback reached in a video, for the library', async () => {
		const { repository, documentId } = await library();
		const played = (fromMs: number, toMs: number) => ({
			kind: 'played',
			at: day(5),
			documentId,
			fromOffset: 0,
			toOffset: 3,
			mediaMs: fromMs,
			speed: 1,
			textVisible: true,
			detail: { toMs }
		});
		repository.recordEncounters(repository.startSession(documentId, 'media'), [
			played(0, 5000),
			played(20000, 31000),
			played(9000, 12000)
		]);
		expect(repository.playedThrough([documentId, documentId + 1])).toEqual(
			new Map([[documentId, 31000]])
		);
	});

	it('finds words from earlier attentive sessions that have no memory yet, and stops', async () => {
		const { db, repository, documentId, words, read } = await library();
		repository.assertState(words[1].lexemeId!, 'ignored');
		const session = repository.startSession(documentId, 'reading');
		repository.recordEncounters(session, [
			read(day(5)),
			{ kind: 'attention', at: day(5, 11), detail: { answer: 'all' } }
		]);
		// As a database written under evidence-1 left it: no memory for words only read past.
		run(db, 'DELETE FROM memory');

		const found = repository.staleMemory(100);
		expect(found).not.toContain(words[1].lexemeId!);
		expect(found.length).toBeGreaterThan(0);
		repository.refreshMemory(found);
		expect(repository.staleMemory(100)).toEqual([]);
	});

	it('is made by an Anki import, under the parameters it brought', async () => {
		const { db, repository } = await library();
		repository.importAnki(anki);
		const seeded = queryRows(db, `SELECT seeded, rule FROM memory WHERE skill = 'reading'`);
		expect(seeded).toHaveLength(5);
		expect(new Set(seeded.map((row) => row.rule))).toEqual(new Set([ruleKey(anki.parameters!)]));
		// 政策 came without a review date in the fixture.
		expect(seeded.map((row) => row.seeded).sort()).toEqual([
			'anki',
			'anki',
			'anki',
			'anki',
			'anki-undated'
		]);
	});

	it('is removed when the word is marked ignored', async () => {
		const { db, repository, documentId, words, lookup } = await library();
		repository.recordEncounters(repository.startSession(documentId, 'reading'), [
			lookup(0, day(1))
		]);
		repository.assertState(words[0].lexemeId!, 'ignored');
		expect(queryRows(db, 'SELECT * FROM memory')).toEqual([]);
	});

	it('rebuilt from nothing, is exactly what was built up event by event', async () => {
		const step = fc.oneof(
			fc.record({
				kind: fc.constant('lookup'),
				word: fc.nat(6),
				day: fc.integer({ min: 1, max: 28 })
			}),
			fc.record({
				kind: fc.constant('check'),
				word: fc.nat(6),
				day: fc.integer({ min: 1, max: 28 })
			}),
			fc.record({
				kind: fc.constant('read'),
				answer: fc.constantFrom('all', 'some', null),
				day: fc.integer({ min: 1, max: 28 })
			}),
			fc.record({
				kind: fc.constant('mark'),
				word: fc.nat(6),
				state: fc.constantFrom('known', 'learning', 'ignored')
			}),
			fc.record({
				kind: fc.constant('review'),
				word: fc.nat(6),
				grade: fc.integer({ min: 1, max: 4 }),
				day: fc.integer({ min: 1, max: 28 })
			}),
			fc.constant({ kind: 'anki' })
		);
		await fc.assert(
			fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 12 }), async (steps) => {
				const { db, repository, documentId, words, lookup, read } = await library();
				for (const s of steps as unknown as Record<string, never>[]) {
					const word = words[s.word % words.length];
					const session = repository.startSession(documentId, 'reading');
					if (s.kind === 'lookup')
						repository.recordEncounters(session, [lookup(s.word % words.length, day(s.day))]);
					if (s.kind === 'check')
						repository.recordEncounters(session, [
							{ ...lookup(s.word % words.length, day(s.day)), kind: 'check' }
						]);
					if (s.kind === 'read')
						repository.recordEncounters(session, [
							read(day(s.day)),
							{ kind: 'attention', at: day(s.day, 11), detail: { answer: s.answer } }
						]);
					if (s.kind === 'mark') repository.assertState(word.lexemeId!, s.state);
					if (s.kind === 'review')
						repository.recordReview(
							word.lexemeId!,
							s.grade,
							{ documentId, fromOffset: word.start, toOffset: word.end },
							day(s.day)
						);
					if (s.kind === 'anki') repository.importAnki(anki);
				}
				const incremental = rows(db);
				repository.rebuildMemory();
				expect(rows(db)).toEqual(incremental);
			}),
			{ numRuns: 40 }
		);
	});

	it('left under an older rule, is shown until the sweep recomputes it', async () => {
		const { db, repository, documentId, lookup } = await library();
		repository.recordEncounters(repository.startSession(documentId, 'reading'), [
			lookup(0, day(1)),
			lookup(1, day(1))
		]);
		const current = rows(db);
		run(db, `UPDATE memory SET rule = 'evidence-0/default', stability = 99`);
		const client = {
			staleMemory: async (limit: number) => repository.staleMemory(limit),
			refreshMemory: async (ids: number[]) => repository.refreshMemory(ids)
		};

		expect(await sweepStaleMemory(client, () => false)).toBe(0);
		expect(queryRows(db, 'SELECT DISTINCT stability FROM memory')).toEqual([{ stability: 99 }]);
		expect(await sweepStaleMemory(client, () => true, 1)).toBe(2);
		expect(rows(db)).toEqual(current);
	});

	it('is read back per skill with the parameters recall needs', async () => {
		const { repository, documentId, words, lookup } = await library();
		repository.importAnki(anki);
		repository.recordEncounters(repository.startSession(documentId, 'reading'), [
			lookup(0, day(1))
		]);

		const { memory, parameters } = repository.getMemory([
			words[0].lexemeId!,
			words[0].lexemeId!,
			999
		]);
		expect(parameters).toEqual({
			preset: 'Default',
			weights: anki.parameters!.weights,
			retention: 0.9
		});
		expect([...memory.keys()]).toEqual([words[0].lexemeId!]);
		expect(memory.get(words[0].lexemeId!)).toMatchObject({
			reading: { card: true, reviewed: false, reps: 1, lapses: 0 },
			listening: { card: false }
		});
	});

	it('is built for a library from before it existed', async () => {
		const { db, repository } = await library();
		repository.importAnki(anki);
		const built = rows(db);
		run(db, 'DELETE FROM memory');

		repository.ensureMemory();
		expect(rows(db)).toEqual(built);
	});

	it('after a correction, is what a rebuild from nothing gives', async () => {
		const { db, repository, documentId, lookup, read } = await library();
		repository.recordEncounters(repository.startSession(documentId, 'reading'), [
			lookup(1, day(1)),
			lookup(5, day(1))
		]);
		const later = repository.startSession(documentId, 'reading');
		repository.recordEncounters(later, [
			read(day(5)),
			{ kind: 'attention', at: day(5, 11), detail: { answer: 'all' } }
		]);
		const before = rows(db);

		// 我看 joined: 我 and 看 lose their tokens there, and 我看 is a new word with its exposure.
		repository.correct('zh', '我看', [{ surface: '我看', key: '我看' }]);
		const kept = rows(db);
		repository.rebuildMemory();

		expect(kept).not.toEqual(before);
		expect(kept).toEqual(rows(db));
	});

	it('counts nothing a withdrawn session did, as if it had never happened', async () => {
		// Libraries alike but for what the first does and then withdraws: a session of only lookups
		// (as a test of lookup speed left), then one read attentively.
		const [withdrawn, attentiveOnly, never] = [await library(), await library(), await library()];
		for (const { repository, documentId, lookup, read } of [withdrawn, attentiveOnly, never]) {
			repository.recordEncounters(repository.startSession(documentId, 'reading'), [
				lookup(0, day(1)),
				read(day(1)),
				{ kind: 'attention', at: day(1, 11), detail: { answer: 'all' } }
			]);
		}
		const attentively = (l: typeof withdrawn) => {
			const session = l.repository.startSession(l.documentId, 'reading');
			l.repository.recordEncounters(session, [
				l.read(day(3)),
				{ kind: 'attention', at: day(3, 11), detail: { answer: 'all' } }
			]);
			return session;
		};
		const { repository, documentId, lookup } = withdrawn;
		const lookups = repository.startSession(documentId, 'reading');
		repository.recordEncounters(lookups, [lookup(1, day(2)), lookup(1, day(2, 11))]);
		const attentive = attentively(withdrawn);
		attentively(attentiveOnly);
		expect(rows(withdrawn.db)).not.toEqual(rows(attentiveOnly.db));

		repository.withdrawSession(lookups, 'test lookups');
		expect(rows(withdrawn.db)).toEqual(rows(attentiveOnly.db));
		repository.withdrawSession(attentive, 'test reading');
		const kept = rows(withdrawn.db);
		expect(kept).toEqual(rows(never.db));
		repository.rebuildMemory();
		expect(rows(withdrawn.db)).toEqual(kept);
	});

	it('forgets a deleted document: all its sessions withdrawn, and it is no longer offered', async () => {
		const withdrawn = await library();
		const never = await library();
		const test = await buildHistory(withdrawn.repository, ['我看书你好将来'], []);
		const { repository } = withdrawn;
		const words = repository.getDocument(test[0]).tokens.filter((t) => t.isWord);
		for (const at of [day(2), day(3)])
			repository.recordEncounters(repository.startSession(test[0], 'reading'), [
				{
					kind: 'lookup',
					at,
					lexemeId: words[1].lexemeId,
					documentId: test[0],
					fromOffset: words[1].start,
					toOffset: words[1].end
				}
			]);
		repository.removeDocument(test[0]);
		expect(repository.deletedWithHistory().map((d) => [d.id, d.sessions, d.lookups])).toEqual([
			[test[0], 2, 2]
		]);

		repository.withdrawDocument(test[0], 'a test copy');
		expect(repository.deletedWithHistory()).toEqual([]);
		expect(rows(withdrawn.db)).toEqual(rows(never.db));
	});

	it('follows a re-segmentation, since the words a stretch covered are its current tokens', async () => {
		const { db, repository, documentId, lookup, read } = await library();
		repository.recordEncounters(repository.startSession(documentId, 'reading'), [
			lookup(1, day(1))
		]);
		const later = repository.startSession(documentId, 'reading');
		repository.recordEncounters(later, [
			read(day(5)),
			{ kind: 'attention', at: day(5, 11), detail: { answer: 'all' } }
		]);
		const before = rows(db);

		const text = repository.getDocument(documentId).rawContent;
		const pairs = resolveTokens(text, await pairwiseAnalyzer.analyze(text), pairwiseAnalyzer);
		repository.replaceTokens(documentId, pairs, stampOf(pairwiseAnalyzer));
		const kept = rows(db);
		repository.rebuildMemory();

		// 看 is now inside 我看: the read stretch no longer covers it, so its passive success goes.
		expect(kept).not.toEqual(before);
		expect(kept).toEqual(rows(db));
	});
});
