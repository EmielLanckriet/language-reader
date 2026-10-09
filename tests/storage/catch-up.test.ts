import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { queryRows, run, type Database } from '../../src/lib/storage/db';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { freshDatabase, pairwiseAnalyzer } from './support';

// Issue #1: the catch-up run at every start (re-applying corrections, finding words with no memory
// yet) took 2.5 s and 1.75 s on the phone while finding nothing, and the library waited behind it.
// A pass that found everything in order is skipped until something it reads has changed.

const parts = (...surfaces: string[]) => surfaces.map((surface) => ({ surface, key: surface }));
const day = (n: number, hour = 10) => new Date(Date.UTC(2026, 9, n, hour)).toISOString();

async function save(repository: Repository, text: string) {
	return repository.saveDocument(
		{ rawContent: text, contentType: 'text/plain', language: 'zh', title: text },
		resolveTokens(text, await pairwiseAnalyzer.analyze(text), pairwiseAnalyzer),
		stampOf(pairwiseAnalyzer)
	);
}

/** Tokens as the old one-pass rule left them: every character its own word. */
function oldRuleTokens(db: Database, id: number, text: string) {
	const lexeme = (surface: string) =>
		Number(queryRows(db, 'SELECT id FROM lexeme WHERE surface = ?', [surface])[0].id);
	run(db, 'DELETE FROM token WHERE document_id = ?', [id]);
	[...text].forEach((surface, start) =>
		run(
			db,
			'INSERT INTO token (document_id, lexeme_id, start, end, is_word) VALUES (?, ?, ?, ?, 1)',
			[id, lexeme(surface), start, start + 1]
		)
	);
}

describe('the catch-up at start', () => {
	it('re-applies corrections once, then skips until corrections or documents change', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		const text = '华崑智驾';
		const id = await save(repository, text);
		repository.correct('zh', '华崑', parts('华', '崑'));
		repository.correct('zh', '智驾', parts('智', '驾'));
		repository.correct('zh', '崑智', parts('崑智'));
		oldRuleTokens(db, id, text);

		expect(repository.reapplyCorrections()).toBe(1);
		expect(repository.reapplyCorrections()).toBeNull();

		repository.correct('zh', '驾', parts('驾'));
		expect(repository.reapplyCorrections()).not.toBeNull();
		expect(repository.reapplyCorrections()).toBeNull();

		await save(repository, '智驾华崑');
		expect(repository.reapplyCorrections()).not.toBeNull();
		expect(repository.reapplyCorrections()).toBeNull();
	});

	it('looks for words with no memory once, then skips until documents or the rule change', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		const id = await save(repository, '我看书你好');
		const session = repository.startSession(id, 'reading');
		repository.recordEncounters(session, [
			{ kind: 'read', at: day(5), documentId: id, fromOffset: 0, toOffset: 5 },
			{ kind: 'attention', at: day(5, 11), detail: { answer: 'all' } }
		]);
		// As a database written under evidence-1 left it: no memory for words only read past.
		run(db, 'DELETE FROM memory');

		// A batch at a time, as the sweep asks: a batch found is not the pass done.
		let batches = 0;
		for (
			let found = repository.staleMemory(1);
			found.length > 0;
			found = repository.staleMemory(1)
		) {
			repository.refreshMemory(found);
			batches++;
		}
		expect(batches).toBe(3);

		// Nothing it reads has changed, so it does not look again, even at a library it would fault.
		run(db, 'DELETE FROM memory');
		expect(repository.staleMemory(100)).toEqual([]);

		await save(repository, '他看报');
		expect(repository.staleMemory(100).length).toBeGreaterThan(0);
	});
});
