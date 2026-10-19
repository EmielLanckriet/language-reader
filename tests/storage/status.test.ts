import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Repository } from '../../src/lib/storage/repository';
import { deviceIdOf, nextDeviceSeq, queryRows, run, type Database } from '../../src/lib/storage/db';
import { parseAnkiExport } from '../../src/lib/domain/anki';
import { legacyActive } from '../../src/lib/domain/legacy-active';
import { upgrade } from '../../src/lib/backup/format';
import type { WordHistory } from '../../src/lib/domain/memory';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';

// Spec 019 (ADR-0044): a word's status, stored apart from its memory.

async function library(text = '我看书。') {
	const db = await freshDatabase();
	const repository = new Repository(db);
	const [id] = await buildHistory(repository, [text], []);
	const words = repository
		.getDocument(id)
		.tokens.filter((t) => t.isWord)
		.map((t) => t.lexemeId!);
	return { db, repository, words, documentId: id };
}

const log = (db: Awaited<ReturnType<typeof freshDatabase>>) =>
	queryRows(db, 'SELECT lexeme_id, status, cause FROM status_change ORDER BY device_seq').map(
		(row) => [Number(row.lexeme_id), String(row.status), String(row.cause)]
	);

describe('a status set by the reader', () => {
	it('is one reader change in the log and the current status', async () => {
		const { db, repository, words } = await library();
		const [word, other] = words;
		repository.setStatus(word, 'ignored');
		expect(log(db)).toEqual([[word, 'ignored', 'reader']]);
		const statuses = repository.getStatuses([word, other]);
		expect(statuses.get(word)).toBe('ignored');
		expect(statuses.get(other)).toBe('retired');
	});

	it('replays to what is stored, so rebuilding changes nothing', async () => {
		const { db, repository, words } = await library();
		const [word, other] = words;
		repository.setStatus(word, 'ignored');
		repository.setStatus(other, 'ignored');
		repository.setStatus(word, 'retired');
		const before = queryRows(db, 'SELECT * FROM word_status ORDER BY lexeme_id');
		repository.rebuildStatuses();
		expect(queryRows(db, 'SELECT * FROM word_status ORDER BY lexeme_id')).toEqual(before);
		expect(repository.getStatuses([word, other])).toEqual(
			new Map([
				[word, 'retired'],
				[other, 'ignored']
			])
		);
	});

	it('is refused, and writes nothing, for a status that does not exist', async () => {
		const { db, repository, words } = await library();
		expect(() => repository.setStatus(words[0], 'known' as never)).toThrow();
		expect(log(db)).toEqual([]);
		expect(queryRows(db, 'SELECT * FROM word_status')).toEqual([]);
	});
});

// The switch (spec 019, FR-016–FR-018): once per library, words active under the old rule become
// active, and every hand, `ignored` and `retired` mark goes.

const fixture = parseAnkiExport(readFileSync('tests/fixtures/anki/anki-words-v2.json', 'utf8'));
const ankiWords = (words: [string, number][]) => ({
	...fixture,
	exportedAt: `2026-09-2${words.length}T10:00:00Z`,
	words: words.map(([word, stability], i) => ({ ...fixture.words[i % 2], word, stability }))
});

/** A library as the version before spec 019 left it: built, then its statuses taken away. */
async function beforeTheSwitch() {
	const { db, repository, documentId } = await library('我看书你来了他走吧');
	const id = (word: string) => repository.findOrCreateLexeme('zh', word);
	repository.importAnki(
		ankiWords([
			['我', 10],
			['书', 10],
			['来', 30]
		])
	);
	repository.recordEncounters(repository.startSession(documentId, 'reading'), [
		{
			kind: 'lookup',
			at: '2026-10-01T10:00:00Z',
			lexemeId: id('看'),
			documentId,
			fromOffset: 1,
			toOffset: 2
		}
	]);
	repository.recordReview(id('看'), 3, undefined, '2026-10-02T10:00:00Z');
	// Set aside, then ended by hand; retired by hand at 30 days; the old hand marks.
	oldMark(db, id('书'), 'retired', 'set aside: outside the 2000 most common words');
	oldMark(db, id('书'), '(none)', 'manual');
	oldMark(db, id('来'), 'retired', 'manual');
	oldMark(db, id('了'), 'learning', 'manual');
	oldMark(db, id('他'), 'known', 'manual');
	oldMark(db, id('走'), 'unknown', 'manual');
	oldMark(db, id('吧'), 'ignored', 'manual');
	repository.rebuildProjection();
	// An Anki import undone: its (none) stays, as the import's own.
	const later = ankiWords([
		['你', 3],
		['吧', 3],
		['了', 3],
		['他', 3]
	]);
	repository.importAnki(later);
	repository.undoAnkiImport(later.exportedAt);
	repository.rebuildProjection();
	run(db, `DELETE FROM encounter WHERE kind = 'status-switch'`);
	run(db, 'DELETE FROM status_change');
	run(db, 'DELETE FROM word_status');
	return { db, repository, id };
}

function oldMark(db: Database, lexemeId: number, asserted: string, provenance: string) {
	const deviceId = deviceIdOf(db);
	run(
		db,
		`INSERT INTO status_event (lexeme_id, asserted, asserted_at, device_id, device_seq, provenance)
     VALUES (?, ?, '2026-10-05T10:00:00Z', ?, ?, ?)`,
		[lexemeId, asserted, deviceId, nextDeviceSeq(db, deviceId), provenance]
	);
}

const marksLeft = (db: Database) =>
	queryRows(db, 'SELECT DISTINCT asserted FROM status_event ORDER BY asserted').map((r) =>
		String(r.asserted)
	);

describe('the switch to statuses', () => {
	it('makes active exactly the words active under the old rule, and deletes the old marks', async () => {
		const { db, repository, id } = await beforeTheSwitch();
		const wasActive = new Set(
			['我', '看', '书', '你', '来', '了', '他', '走', '吧'].filter((w) =>
				legacyActive(
					(repository as unknown as { wordHistory(id: number): WordHistory }).wordHistory(id(w))
				)
			)
		);
		// 书's set-aside was ended by hand, so it was an active Anki word again (误会 on the phone).
		expect([...wasActive].sort()).toEqual(['书', '我', '看'].sort());

		repository.switchToStatuses();
		expect(log(db)).toEqual(
			[id('我'), id('看'), id('书')]
				.sort((a, b) => a - b)
				.map((word) => [word, 'active', 'carried-over'])
		);
		expect(marksLeft(db).filter((m) => !m.startsWith('anki-'))).toEqual(['(none)']);
		// The import's (none) stays, on the one word it marked from nothing (the others carried the
		// reader's own marks, which an import leaves alone); 书's undo of a set-aside is gone.
		const nones = queryRows(db, `SELECT lexeme_id FROM status_event WHERE asserted = '(none)'`).map(
			(r) => Number(r.lexeme_id)
		);
		expect(nones).toEqual([id('你')]);
		// The stored marks are the replay of what is left.
		const states = queryRows(db, 'SELECT * FROM word_state ORDER BY lexeme_id');
		repository.rebuildProjection();
		expect(queryRows(db, 'SELECT * FROM word_state ORDER BY lexeme_id')).toEqual(states);
		const recorded = queryRows(db, `SELECT detail FROM encounter WHERE kind = 'status-switch'`);
		expect(recorded.map((r) => JSON.parse(String(r.detail)))).toEqual([
			{ carried: 3, deletedMarks: 7 }
		]);
	});

	it('runs once', async () => {
		const { db, repository } = await beforeTheSwitch();
		repository.switchToStatuses();
		const after = queryRows(db, 'SELECT * FROM status_change');
		repository.switchToStatuses();
		expect(queryRows(db, 'SELECT * FROM status_change')).toEqual(after);
		expect(queryRows(db, `SELECT 1 FROM encounter WHERE kind = 'status-switch'`)).toHaveLength(1);
	});

	it('then lets a word retired by hand past 14 days become active, as nothing records the retire', async () => {
		const { repository, id } = await beforeTheSwitch();
		repository.switchToStatuses();
		expect(repository.getStatuses([id('来')]).get(id('来'))).toBe('retired');
		repository.rebuildMemory();
		expect(repository.getStatuses([id('来')]).get(id('来'))).toBe('active');
		expect(repository.readStatusLog(id('来')).map((c) => c.cause)).toEqual(['stable']);
	});

	it('reads the old rule from memory rows stored under it, where there are any', async () => {
		const { db, repository, id } = await beforeTheSwitch();
		// 来 was not active by its history (retired by hand); a row computed under the old rule says it was.
		run(
			db,
			`UPDATE memory SET rule = 'evidence-4+no-steps+known-2+stable-14' || substr(rule, instr(rule, '/')),
              card = 1, reviewed = 1
        WHERE lexeme_id = ? AND skill = 'reading'`,
			[id('来')]
		);
		repository.switchToStatuses();
		expect(repository.readStatusLog(id('来')).map((c) => c.cause)).toEqual(['carried-over']);
	});

	it('is recorded as having run on a new, empty library', async () => {
		const db = await freshDatabase();
		new Repository(db);
		expect(
			queryRows(db, `SELECT detail FROM encounter WHERE kind = 'status-switch'`).map((r) =>
				JSON.parse(String(r.detail))
			)
		).toEqual([{ carried: 0, deletedMarks: 0 }]);
	});
});

describe('statuses in a copy (format 4)', () => {
	it('come back exactly on restore', async () => {
		const { db, repository, words } = await library();
		const form = (lexemeId: number) =>
			String(queryRows(db, 'SELECT surface FROM lexeme WHERE id = ?', [lexemeId])[0].surface);
		repository.setStatus(words[0], 'ignored');
		repository.setStatus(words[1], 'ignored');
		repository.setStatus(words[1], 'active');
		const copy = repository.exportBody('test', '2026-10-20T10:00:00Z');
		const restored = new Repository(await freshDatabase());
		restored.restoreCopy(copy);
		const id = (lexemeId: number) => restored.findOrCreateLexeme('zh', form(lexemeId));
		expect(restored.getStatuses([id(words[0]), id(words[1])])).toEqual(
			new Map([
				[id(words[0]), 'ignored'],
				[id(words[1]), 'active']
			])
		);
		expect(restored.readStatusLog().map((c) => [c.status, c.cause, c.deviceSeq])).toEqual(
			repository.readStatusLog().map((c) => [c.status, c.cause, c.deviceSeq])
		);
	});

	it('runs the switch on a copy made before it', async () => {
		const { repository } = await beforeTheSwitch();
		const copy = repository.exportBody('test', '2026-10-20T10:00:00Z');
		const older: Partial<typeof copy> = { ...copy, format: 3 };
		delete older.statuses;
		const old = upgrade(older as typeof copy);
		const restored = new Repository(await freshDatabase());
		restored.restoreCopy(old);
		const 我 = restored.findOrCreateLexeme('zh', '我');
		expect(restored.getStatuses([我]).get(我)).toBe('active');
		expect(restored.readStatusLog().map((c) => c.cause)).toContain('carried-over');
	});
});

// The one place a word becomes active (FR-005–FR-008): after its memory is recomputed.
describe('becoming active in the repository', () => {
	async function tappedWord() {
		const { db, repository, words, documentId } = await library();
		const [word] = words;
		const session = repository.startSession(documentId, 'reading');
		repository.recordEncounters(session, [
			{
				kind: 'lookup',
				at: '2026-10-01T10:00:00Z',
				lexemeId: word,
				documentId,
				fromOffset: 0,
				toOffset: 1
			}
		]);
		return { db, repository, word, documentId, session };
	}
	const statusOf = (repository: Repository, word: number) =>
		repository.getStatuses([word]).get(word);

	it('offers a tapped retired word as new, and its first Cards review makes it active', async () => {
		const { repository, word } = await tappedWord();
		expect(statusOf(repository, word)).toBe('retired');
		expect(repository.cardsToday(10).queue.fresh).toEqual([word]);
		repository.recordReview(word, 3, undefined, '2026-10-01T11:00:00Z');
		expect(statusOf(repository, word)).toBe('active');
		expect(repository.readStatusLog(word).map((c) => c.cause)).toEqual(['first-review']);
	});

	it('is not reached by a drill grade under 14 days', async () => {
		const { repository, word, documentId } = await tappedWord();
		repository.recordEncounters(repository.startSession(documentId, 'hardcore'), [
			{
				kind: 'review',
				at: '2026-10-01T11:00:00Z',
				lexemeId: word,
				documentId,
				fromOffset: 0,
				toOffset: 1,
				detail: { skill: 'reading', grade: 3, hardcore: { part: 0 }, line: [0, 4] }
			}
		]);
		expect(statusOf(repository, word)).toBe('retired');
	});

	it('is reached by an Anki seed at 14 days or more, and not by one under it', async () => {
		const { repository } = await library('我看书');
		repository.importAnki(
			ankiWords([
				['我', 30],
				['看', 5]
			])
		);
		const id = (w: string) => repository.findOrCreateLexeme('zh', w);
		expect(statusOf(repository, id('我'))).toBe('active');
		expect(repository.readStatusLog(id('我')).map((c) => c.cause)).toEqual(['stable']);
		expect(statusOf(repository, id('看'))).toBe('retired');
	});

	it('never moves an ignored word, and an active word stays active after a tap', async () => {
		const { repository } = await library('我看书');
		const id = (w: string) => repository.findOrCreateLexeme('zh', w);
		repository.setStatus(id('我'), 'ignored');
		repository.importAnki(
			ankiWords([
				['我', 30],
				['看', 30]
			])
		);
		expect(statusOf(repository, id('我'))).toBe('ignored');
		expect(statusOf(repository, id('看'))).toBe('active');
		repository.recordReview(id('看'), 1, undefined, '2026-12-01T10:00:00Z');
		expect(repository.getMemory([id('看')]).memory.get(id('看'))!.reading!.stability).toBeLessThan(
			14
		);
		expect(statusOf(repository, id('看'))).toBe('active');
	});

	it('keeps an active word active when the session that led to it is withdrawn', async () => {
		const { repository, word, session } = await tappedWord();
		repository.recordReview(word, 3, undefined, '2026-10-01T11:00:00Z');
		repository.withdrawSession(session, 'test');
		expect(statusOf(repository, word)).toBe('active');
	});

	it('puts a hand retire before the 14-day rule until stability falls under 14 again', async () => {
		const { repository, documentId } = await library('我看书');
		const id = (w: string) => repository.findOrCreateLexeme('zh', w);
		repository.importAnki(ankiWords([['我', 30]]));
		expect(statusOf(repository, id('我'))).toBe('active');
		repository.setStatus(id('我'), 'retired');
		// Drilled on, past 30 days: it stays retired, as its stability never fell under 14.
		const drill = (grade: number, at: string) =>
			repository.recordEncounters(repository.startSession(documentId, 'hardcore'), [
				{
					kind: 'review',
					at,
					lexemeId: id('我'),
					documentId,
					fromOffset: 0,
					toOffset: 1,
					detail: { skill: 'reading', grade, hardcore: { part: 0 }, line: [0, 3] }
				}
			]);
		drill(3, '2026-11-01T10:00:00Z');
		expect(statusOf(repository, id('我'))).toBe('retired');
		// Forgotten, then drilled back past 14 days: active again.
		drill(1, '2027-06-01T10:00:00Z');
		for (let day = 2; statusOf(repository, id('我')) === 'retired' && day < 300; day *= 2)
			drill(3, new Date(Date.UTC(2027, 5, 1 + day, 10)).toISOString());
		expect(statusOf(repository, id('我'))).toBe('active');
		expect(repository.readStatusLog(id('我')).map((c) => c.cause)).toEqual([
			'stable',
			'reader',
			'stable'
		]);
	});
});

describe('Cards by status (FR-009, FR-010)', () => {
	it('never offers an ignored word, nor a retired one as due', async () => {
		const { repository, documentId } = await library('我看书');
		const id = (w: string) => repository.findOrCreateLexeme('zh', w);
		repository.recordEncounters(repository.startSession(documentId, 'reading'), [
			{
				kind: 'lookup',
				at: '2026-10-01T10:00:00Z',
				lexemeId: id('我'),
				documentId,
				fromOffset: 0,
				toOffset: 1
			},
			{
				kind: 'lookup',
				at: '2026-10-01T10:01:00Z',
				lexemeId: id('看'),
				documentId,
				fromOffset: 1,
				toOffset: 2
			}
		]);
		repository.importAnki(ankiWords([['书', 5]]));
		repository.setStatus(id('我'), 'ignored');
		const later = new Date('2027-01-01T00:00:00Z');
		const { queue } = repository.cardsToday(10, later);
		expect(queue.fresh).toEqual([id('看')]);
		expect(queue.due).toEqual([]);
		repository.setStatus(id('书'), 'active');
		// A card needs a sentence: 书 waits until it is met.
		expect(repository.cardsToday(10, later).counts.awaitingContext).toBe(1);
		repository.recordEncounters(repository.startSession(documentId, 'reading'), [
			{ kind: 'read', at: '2026-10-02T10:00:00Z', documentId, fromOffset: 0, toOffset: 3 }
		]);
		expect(repository.cardsToday(10, later).queue.due).toEqual([id('书')]);
	});
});

describe("a word's status for its buttons (FR-013, FR-014)", () => {
	it('says whether the reader set it, and what it was before, for undo', async () => {
		const { repository, words } = await library();
		const [word] = words;
		expect(repository.statusDetail(word)).toEqual({ status: 'retired', byReader: false });
		repository.setStatus(word, 'active');
		repository.setStatus(word, 'ignored');
		expect(repository.statusDetail(word)).toEqual({
			status: 'ignored',
			byReader: true,
			before: 'active'
		});
		repository.setStatus(word, repository.statusDetail(word).before!);
		expect(repository.statusDetail(word)).toMatchObject({ status: 'active', before: 'ignored' });
	});
});
