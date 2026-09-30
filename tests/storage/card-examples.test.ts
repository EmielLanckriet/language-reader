import { expect, it } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from './support';
import { queryRows } from '../../src/lib/storage/db';

const example = {
	key: 'test:123',
	word: '学习',
	text: '我们学习中文。',
	translation: 'We study Chinese.',
	pinyin: 'wǒ men xué xí zhōng wén',
	profile: 'Test',
	noteId: '123',
	original: { SentenceSimplified: '我们学习中文。' }
};
it('retains imported examples through reimport and backup without making reviews or encounters', async () => {
	const db = await freshDatabase();
	const repo = new Repository(db);
	expect(repo.importCardExamples([example])).toBe(1);
	const word = repo.findOrCreateLexeme('zh', '学习');
	expect(repo.cardSentence(word)).toMatchObject({
		source: 'anki',
		text: example.text,
		wordFrom: 2,
		wordTo: 4,
		translation: example.translation
	});
	expect(repo.importCardExamples([example])).toBe(0);
	expect(
		queryRows(db, "SELECT * FROM encounter WHERE kind IN ('read','played','review')")
	).toHaveLength(0);
	expect(repo.getMemory([word]).memory.size).toBe(0);
	const copy = repo.exportBody('2026-09-30T12:00:00Z', 'test');
	const restored = new Repository(await freshDatabase());
	restored.restoreCopy(copy);
	expect(restored.cardSentence(restored.findOrCreateLexeme('zh', '学习'))).toMatchObject({
		text: example.text,
		source: 'anki'
	});
	expect(() => repo.importCardExamples([{ ...example, text: 'missing target' }])).toThrow();
	expect(repo.importCardExamples([{ ...example, translation: 'Updated meaning' }])).toBe(1);
	expect(repo.cardSentence(word)?.translation).toBe('Updated meaning');
});
it('records which imported example was reviewed without inventing a document occurrence', async () => {
	const db = await freshDatabase();
	const repo = new Repository(db);
	repo.importCardExamples([example]);
	const word = repo.findOrCreateLexeme('zh', example.word);
	repo.recordReview(word, 3, undefined, '2026-09-30T12:00:00Z', 'anki:test:123');
	const row = queryRows(db, "SELECT document_id,detail FROM encounter WHERE kind='review'")[0];
	expect(row.document_id).toBeNull();
	expect(JSON.parse(String(row.detail)).exampleKey).toBe('anki:test:123');
});
