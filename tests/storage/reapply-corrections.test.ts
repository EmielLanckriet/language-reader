import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { queryRows, run } from '../../src/lib/storage/db';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { freshDatabase, pairwiseAnalyzer } from './support';
import { characterSplitter } from '../../src/lib/analyzer/character';

// Issue #2: corrections now apply in the order they were made, each to the words the ones before it
// left. Documents already on the phone hold tokens from the old one-pass rule, so the app re-applies
// the corrections once it opens, rewriting only documents whose words come out different.

const parts = (...surfaces: string[]) => surfaces.map((surface) => ({ surface, key: surface }));

describe('re-applying corrections', () => {
	it('brings a document made under the old rule up to date, and then leaves it alone', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		const text = '华崑智驾';
		const id = repository.saveDocument(
			{ rawContent: text, contentType: 'text/plain', language: 'zh', title: text },
			resolveTokens(text, await pairwiseAnalyzer.analyze(text), pairwiseAnalyzer),
			stampOf(pairwiseAnalyzer)
		);
		repository.correct('zh', '华崑', parts('华', '崑'), {
			documentId: id,
			fromOffset: 0,
			toOffset: 0
		});
		repository.correct('zh', '智驾', parts('智', '驾'), {
			documentId: id,
			fromOffset: 0,
			toOffset: 0
		});
		repository.correct('zh', '崑智', parts('崑智'), { documentId: id, fromOffset: 0, toOffset: 0 });

		// What the old rule left: the join never applied, since 崑 and 智 were never whole analyzer words.
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

		expect(repository.reapplyCorrections()?.rewritten).toBe(1);
		const words = () =>
			repository.getDocument(id).tokens.map((t) => [...text].slice(t.start, t.end).join(''));
		expect(words()).toEqual(['华', '崑智', '驾']);
		// A second full pass, not the skip the catch-up marker would give (catch-up.test.ts).
		run(db, 'DELETE FROM catch_up');
		expect(repository.reapplyCorrections()?.rewritten).toBe(0);
		expect(words()).toEqual(['华', '崑智', '驾']);
	});

	it('takes a rule out of the documents it was not made in, a document per step (ADR-0049)', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		const save = async (text: string) =>
			repository.saveDocument(
				{ rawContent: text, contentType: 'text/plain', language: 'zh', title: text },
				resolveTokens(text, await characterSplitter.analyze(text), characterSplitter),
				stampOf(characterSplitter)
			);
		const ids = [await save('一个。'), await save('有一个。'), await save('一个人。')];
		for (const id of ids)
			repository.correct('zh', '一个', parts('一个'), {
				documentId: id,
				fromOffset: 0,
				toOffset: 2
			});
		// What a library-wide rule left behind: the later documents joined by the first one's rule.
		run(db, 'DELETE FROM correction_event WHERE document_id != ?', [ids[0]]);
		const words = (id: number) => {
			const text = repository.getDocument(id).rawContent;
			return repository.getDocument(id).tokens.map((t) => [...text].slice(t.start, t.end).join(''));
		};

		let next: number | null = 0;
		let steps = 0;
		while (next !== null) {
			const step = repository.reapplyCorrections(next, 0);
			expect(step).not.toBeNull();
			next = step!.next;
			steps++;
		}
		expect(steps).toBeGreaterThan(1);
		expect(words(ids[0])).toEqual(['一个', '。']);
		expect(words(ids[1])).toEqual(['有', '一', '个', '。']);
		expect(words(ids[2])).toEqual(['一', '个', '人', '。']);
		expect(repository.reapplyCorrections()).toBeNull();
	});
});
