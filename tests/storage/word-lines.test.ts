import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { characterSplitter } from '../../src/lib/analyzer/character';
import { resolveTokens, stampOf } from '../../src/lib/analyzer/resolve';
import { pasteSource } from '../../src/lib/content/paste';
import { freshDatabase } from './support';

// The library's recurring words: in how many separate lines a word occurs, not how often. Token
// offsets count code points, so astral characters before a line break must not shift it.

describe('wordLines', () => {
	it('counts the separate lines each word occurs in', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		const document = await pasteSource.ingest('😀😀你\n你我我我\n我');
		const tokens = resolveTokens(
			document.rawContent,
			await characterSplitter.analyze(document.rawContent),
			characterSplitter
		);
		const documentId = repository.saveDocument(document, tokens, stampOf(characterSplitter));
		const words = repository.getDocument(documentId).tokens.filter((t) => t.isWord);
		const word = (text: string) =>
			words.find((t) => [...document.rawContent].slice(t.start, t.end).join('') === text)!;
		const [ni, wo] = [word('你'), word('我')];

		const lines = repository.wordLines([documentId, documentId + 1]).get(documentId)!;
		expect(lines.get(ni.lexemeId!)).toBe(2);
		expect(lines.get(wo.lexemeId!)).toBe(2);
		expect(repository.wordLines([documentId + 1]).size).toBe(0);
		db.close();
	});
});
