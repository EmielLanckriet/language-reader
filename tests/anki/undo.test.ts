import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAnkiExport } from '../../src/lib/domain/anki';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from '../storage/support';

// Undoing an import (spec 006, FR-008): every word whose state is from that import goes back to what
// it had before, by appending, never by deleting. The reader's own marks and a later import's words
// are left as they are.

const fixture = parseAnkiExport(readFileSync('tests/fixtures/anki/anki-words.json', 'utf8'));
const LATER = '2026-10-03T00:00:00Z';

function body(repository: Repository) {
	const copy = repository.exportBody('test', 'now');
	return {
		states: Object.fromEntries(copy.states.map((state) => [state.surface, state.state])),
		events: copy.events.length
	};
}

describe('undoing an Anki import', () => {
	it('unmarks the words it marked from nothing, and keeps the reader’s own marks', async () => {
		const repository = new Repository(await freshDatabase());
		repository.assertState(repository.findOrCreateLexeme('zh', '将来'), 'learning');
		repository.importAnki(fixture);
		const before = body(repository);

		const undone = repository.undoAnkiImport(fixture.exportedAt);

		const after = body(repository);
		expect(after.states).toEqual({ 将来: 'learning' });
		expect(undone).toBe(4);
		expect(after.events).toBe(before.events + 4);
	});

	it('returns a word to the earlier import’s level, and leaves words a later import changed', async () => {
		const repository = new Repository(await freshDatabase());
		repository.importAnki(fixture);
		const moved = fixture.words.map((word) =>
			word.word === '政策' ? { ...word, stability: 30.4, level: 'anki-mature' } : word
		);
		repository.importAnki({ ...fixture, exportedAt: LATER, words: moved });

		repository.undoAnkiImport(LATER);

		expect(body(repository).states.政策).toBe('anki-young');
		expect(body(repository).states.将来).toBe('anki-long-term');
	});

	it('leaves a word the reader marked after the import', async () => {
		const repository = new Repository(await freshDatabase());
		repository.importAnki(fixture);
		repository.assertState(repository.findOrCreateLexeme('zh', '关税'), 'known');

		repository.undoAnkiImport(fixture.exportedAt);

		expect(body(repository).states).toEqual({ 关税: 'known' });
	});
});
