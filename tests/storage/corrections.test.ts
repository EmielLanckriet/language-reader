import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { characterSplitter } from '../../src/lib/analyzer/character';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { pasteSource } from '../../src/lib/content/paste';
import { codePointsOf } from '../../src/lib/domain/offsets';
import { applyMigrations, loadSqlite, queryRows, type Database } from '../../src/lib/storage/db';
import initialSql from '../../src/lib/storage/migrations/001-initial.sql?raw';
import partialUpgradeSql from '../../src/lib/storage/migrations/002-partial-upgrade.sql?raw';
import encountersSql from '../../src/lib/storage/migrations/003-encounters.sql?raw';
import { freshDatabase, pairwiseAnalyzer } from './support';
import type { Analyzer } from '../../src/lib/analyzer/types';
import type { Part } from '../../src/lib/domain/corrections';
import { open, seal } from '../../src/lib/backup/format';

// Spec 004. Corrections are earned and asserted exactly; the tokens they produce are derived and
// asserted on what the correction promised — this form shows as these parts — never on the rest.

const parts = (...surfaces: string[]): Part[] =>
	surfaces.map((surface) => ({ surface, key: surface }));

describe('correcting the segmentation', () => {
	let db: Database;
	let repository: Repository;

	beforeEach(async () => {
		db = await freshDatabase();
		repository = new Repository(db);
	});
	afterEach(() => db?.close());

	async function save(text: string, analyzer: Analyzer = characterSplitter) {
		const document = await pasteSource.ingest(text);
		const tokens = resolveTokens(text, await analyzer.analyze(text), analyzer);
		return repository.saveDocument(document, tokens, stampOf(analyzer));
	}

	/** The surfaces a document shows, words and all. */
	function shown(id: number): string[] {
		const document = repository.getDocument(id);
		const characters = codePointsOf(document.rawContent);
		return document.tokens.map((t) => characters.slice(t.start, t.end).join(''));
	}

	function marks() {
		return {
			events: queryRows(db, 'SELECT * FROM status_event ORDER BY id'),
			states: queryRows(db, 'SELECT * FROM word_state ORDER BY lexeme_id'),
			lexemes: queryRows(db, 'SELECT * FROM lexeme ORDER BY id').length
		};
	}

	it('joins a form in every document, and in one imported afterwards (US1.1, US1.2)', async () => {
		const first = await save('一个人。');
		const second = await save('我有一个。');
		repository.correct('zh', '一个', parts('一个'), {
			documentId: first,
			fromOffset: 0,
			toOffset: 2
		});
		expect(shown(first)).toEqual(['一个', '人', '。']);
		expect(shown(second)).toEqual(['我', '有', '一个', '。']);
		expect(shown(await save('这是一个。'))).toContain('一个');
	});

	it('records the decision with its order and occurrence, and an undo as a further one (FR-007, FR-008)', async () => {
		const id = await save('一个。');
		repository.correct('zh', '一个', parts('一个'), { documentId: id, fromOffset: 0, toOffset: 2 });
		repository.correct('zh', '一个', null);

		const history = repository.readCorrections();
		expect(history).toHaveLength(2);
		expect(history[0]).toMatchObject({
			language: 'zh',
			form: '一个',
			parts: parts('一个'),
			occurrence: { documentId: id, fromOffset: 0, toOffset: 2 }
		});
		expect(history[1].parts).toBeUndefined();
		expect(history[1].deviceSeq).toBeGreaterThan(history[0].deviceSeq);
		expect(history[0].deviceId).toBe(history[1].deviceId);
		expect(repository.corrections()).toEqual([]);
		expect(shown(id)).toEqual(['一', '个', '。']);
	});

	it('shares the device counter with marks, so both are one history', async () => {
		const id = await save('一个。');
		const word = repository.getDocument(id).tokens[0];
		repository.assertState(word.lexemeId!, 'known');
		repository.correct('zh', '一个', parts('一个'));
		const markSeq = Number(queryRows(db, 'SELECT device_seq FROM status_event')[0].device_seq);
		expect(repository.readCorrections()[0].deviceSeq).toBe(markSeq + 1);
	});

	it('leaves every mark exactly as it was, and a joined word unjudged (SC-004, US1.5)', async () => {
		const id = await save('一个。');
		const yi = repository.getDocument(id).tokens[0];
		repository.assertState(yi.lexemeId!, 'known', { documentId: id, fromOffset: 0, toOffset: 1 });
		const before = marks();

		repository.correct('zh', '一个', parts('一个'));
		repository.correct('zh', '一个', parts('一', '个'));
		repository.correct('zh', '一个', null);

		const after = marks();
		expect(after.events).toEqual(before.events);
		expect(after.states).toEqual(before.states);
		expect(after.lexemes).toBeGreaterThan(before.lexemes); // 一个 exists now; nothing went away
		repository.correct('zh', '一个', parts('一个'));
		const joined = repository.getDocument(id).tokens[0];
		expect(repository.getStates([joined.lexemeId!]).size).toBe(0);
	});

	it('splits a form the analyzer took whole, and the halves are separately markable (US2)', async () => {
		const id = await save('哪国人。', pairwiseAnalyzer);
		const pairs = shown(id);
		const whole = pairs.find((s) => [...s].length === 2)!;
		repository.correct('zh', whole, parts(...[...whole]));
		expect(shown(id).join('')).toBe('哪国人。');
		for (const c of [...whole]) expect(shown(id)).toContain(c);
		const lexemes = repository.getDocument(id).tokens.map((t) => t.lexemeId);
		expect(new Set(lexemes).size).toBe(lexemes.length);
	});

	it('survives re-derivation and a partial upgrade by another analyzer (SC-003, FR-010)', async () => {
		const text = '一个人。一个国。';
		const id = await save(text, pairwiseAnalyzer);
		repository.correct('zh', '一个', parts('一个'));

		// The character splitter cuts 一 · 个 apart; the correction must put them back together.
		const tokens = resolveTokens(text, await characterSplitter.analyze(text), characterSplitter);
		repository.replaceTokens(id, tokens, stampOf(characterSplitter));
		expect(shown(id).filter((s) => s === '一个')).toHaveLength(2);

		const batch = tokens.filter((t) => t.start < 4);
		repository.advanceUpgrade(
			id,
			{ from: 0, through: 4, tokens: batch },
			{ name: 'x', version: '1' }
		);
		expect(shown(id).filter((s) => s === '一个')).toHaveLength(2);
		expect(repository.getDocument(id).upgrade?.through).toBe(4);
	});

	it('refuses parts that are not the form, and writes nothing (FR-004, FR-005)', async () => {
		const id = await save('一个。');
		expect(() => repository.correct('zh', '一个', parts('一'))).toThrow();
		expect(() => repository.correct('zh', '一个', parts('一', '', '个'))).toThrow();
		expect(repository.readCorrections()).toEqual([]);
		expect(shown(id)).toEqual(['一', '个', '。']);
	});

	it('lists what is in force, including a form no document still has (US3.4)', async () => {
		await save('一个。');
		repository.correct('zh', '一个', parts('一个'));
		repository.correct('zh', '国人', parts('国', '人'));
		// Most recent first: the one the reader is likeliest to be looking for.
		expect(repository.corrections().map((c) => [c.form, c.parts])).toEqual([
			['国人', ['国', '人']],
			['一个', ['一个']]
		]);
	});

	it('keeps a document that a correction points into when it is deleted', async () => {
		const id = await save('一个。');
		repository.correct('zh', '一个', parts('一个'), { documentId: id, fromOffset: 0, toOffset: 2 });
		expect(repository.removeDocument(id)).toBe('hidden');
	});
});

describe('a copy', () => {
	it('carries every correction and undo, and a restored document shows them again (FR-010)', async () => {
		const source = new Repository(await freshDatabase());
		const text = '一个国人。';
		const tokens = resolveTokens(text, await characterSplitter.analyze(text), characterSplitter);
		const id = source.saveDocument(
			await pasteSource.ingest(text),
			tokens,
			stampOf(characterSplitter)
		);
		source.correct('zh', '一个', parts('一个'), { documentId: id, fromOffset: 0, toOffset: 2 });
		source.correct('zh', '国人', parts('国人'));
		source.correct('zh', '国人', null);

		const body = source.exportBody('test', 'now');
		const target = new Repository(await freshDatabase());
		const [restored] = [
			...target.restoreCopy(await open(JSON.stringify(await seal(body)))).values()
		];

		expect(target.exportBody('test', 'now').corrections).toEqual(body.corrections);
		target.replaceTokens(restored, tokens, stampOf(characterSplitter));
		const document = target.getDocument(restored);
		expect(document.tokens.map((t) => t.end - t.start)).toEqual([2, 1, 1, 1]);
	});
});

describe('migration 004', () => {
	it("keeps the analyzer's own tokens for documents that already exist", async () => {
		const sqlite3 = await loadSqlite();
		const db = new sqlite3.oo1.DB(':memory:', 'c');
		try {
			db.exec(`CREATE TABLE schema_migration (
        version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)`);
			for (const [version, sql] of [initialSql, partialUpgradeSql, encountersSql].entries()) {
				db.exec(sql);
				db.exec(`INSERT INTO schema_migration VALUES (${version + 1}, 'm', 'now')`);
			}
			db.exec(`INSERT INTO document (id, raw_content, content_type, language, analyzer,
        analyzer_version, title, created_at) VALUES (1, '一个。', 'text/plain', 'zh', 'a', '1', 't', 'now')`);
			db.exec("INSERT INTO lexeme (id, language, surface) VALUES (5, 'zh', '一个')");
			db.exec(`INSERT INTO token (document_id, lexeme_id, start, end, is_word)
        VALUES (1, 5, 0, 2, 1), (1, NULL, 2, 3, 0)`);

			applyMigrations(db);

			expect(queryRows(db, 'SELECT * FROM analyzed_token ORDER BY start')).toEqual([
				{ document_id: 1, start: 0, end: 2, is_word: 1, lexeme_key: '一个' },
				{ document_id: 1, start: 2, end: 3, is_word: 0, lexeme_key: null }
			]);
			expect(queryRows(db, 'SELECT COUNT(*) AS n FROM token')[0].n).toBe(2);
		} finally {
			db.close();
		}
	});
});
