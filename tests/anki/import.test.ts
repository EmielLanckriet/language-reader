import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAnkiExport, type AnkiExport } from '../../src/lib/domain/anki';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from '../storage/support';
import { dump } from '../backup/support';

// Importing Anki words writes earned data (spec 006): one transaction, tagged Anki, never over the
// reader's own judgment, and a re-import writes only what changed (FR-004 to FR-009).

const fixture = parseAnkiExport(readFileSync('tests/fixtures/anki/anki-words.json', 'utf8'));

function statesOf(repository: Repository) {
	return Object.fromEntries(
		repository.exportBody('test', 'now').states.map((state) => [state.surface, state.state])
	);
}

describe('importing Anki words', () => {
	it('gives every word its level, words in no document included, each tagged with its import', async () => {
		const repository = new Repository(await freshDatabase());

		const result = repository.importAnki(fixture);

		expect(result.set).toBe(5);
		expect(statesOf(repository)).toEqual({
			将来: 'anki-long-term',
			关税: 'anki-mature',
			政策: 'anki-young',
			违法: 'anki-learning',
			朋友: 'anki-mature'
		});
		const events = repository.exportBody('test', 'now').events;
		expect(events.map((event) => event.provenance)).toContain(`anki ${fixture.exportedAt} s=983.7`);
		expect(events.every((event) => event.documentId === undefined)).toBe(true);
	});

	it('never replaces a judgment the reader made themselves', async () => {
		const repository = new Repository(await freshDatabase());
		repository.importAnki(fixture);
		repository.assertState(repository.findOrCreateLexeme('zh', '关税'), 'known');

		const later: AnkiExport = { ...fixture, exportedAt: '2026-10-03T00:00:00Z' };
		const result = repository.importAnki(later);

		expect(statesOf(repository).关税).toBe('known');
		expect(result.keptOwn).toEqual(['关税']);
	});

	it('writes nothing at all when it fails part-way', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		const before = dump(db);
		const broken = {
			...fixture,
			words: [
				...fixture.words,
				{ ...fixture.words[0], word: '坏', level: null as unknown as string }
			]
		};

		expect(() => repository.importAnki(broken)).toThrow();
		expect(dump(db)).toBe(before);
	});
});

describe('importing again', () => {
	it('writes nothing for an unchanged collection', async () => {
		const repository = new Repository(await freshDatabase());
		repository.importAnki(fixture);
		const events = repository.exportBody('test', 'now').events.length;

		const again = repository.importAnki({ ...fixture, exportedAt: '2026-10-03T00:00:00Z' });

		expect(again).toMatchObject({ set: 0, unchanged: 5 });
		expect(repository.exportBody('test', 'now').events).toHaveLength(events);
	});

	it('writes exactly one event for the one word whose strength moved', async () => {
		const repository = new Repository(await freshDatabase());
		repository.importAnki(fixture);
		const events = repository.exportBody('test', 'now').events.length;
		const moved = fixture.words.map((word) =>
			word.word === '政策' ? { ...word, stability: 30.4, level: 'anki-mature' } : word
		);

		repository.importAnki({ ...fixture, exportedAt: '2026-10-03T00:00:00Z', words: moved });

		expect(repository.exportBody('test', 'now').events).toHaveLength(events + 1);
		expect(statesOf(repository).政策).toBe('anki-mature');
	});
});
