import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ankiProvenance, ankiSeedOf, parseAnkiExport, planImport } from '../../src/lib/domain/anki';

// Format 2 carries what the scheduler starts a word from (spec 007, FR-014): difficulty, the last
// review and the card's decay, kept in the imported judgment's provenance.

const one = parseAnkiExport(readFileSync('tests/fixtures/anki/anki-words.json', 'utf8'));
const two = parseAnkiExport(readFileSync('tests/fixtures/anki/anki-words-v2.json', 'utf8'));
const ID = two.exportedAt;

describe('an Anki seed', () => {
	it('is written into the provenance of a format-2 word', () => {
		const plan = planImport(two, () => undefined);
		expect(plan.set[0].provenance).toBe(
			`anki ${ID} s=983.7 d=6.708 r=2026-08-18T14:55:20Z decay=0.264`
		);
		expect(plan.set.find((entry) => entry.word === '政策')!.provenance).toBe(`anki ${ID} s=12.5`);
	});

	it('is read back from a format-2 provenance', () => {
		expect(ankiSeedOf(`anki ${ID} s=983.7 d=6.708 r=2026-08-18T14:55:20Z decay=0.264`)).toEqual({
			stability: 983.7,
			difficulty: 6.708,
			lastReview: '2026-08-18T14:55:20Z',
			decay: 0.264,
			dateKnown: true
		});
	});

	it('falls back, and says so, for a format-1 provenance', () => {
		expect(ankiSeedOf('anki 2026-09-26T21:04:11Z s=12.5')).toEqual({
			stability: 12.5,
			difficulty: 5,
			lastReview: '2026-09-26T21:04:11Z',
			decay: undefined,
			dateKnown: false
		});
	});

	it('is nothing for a judgment Anki did not make, or an undo', () => {
		expect(ankiSeedOf('manual')).toBeUndefined();
		expect(ankiSeedOf(`anki ${ID} undo`)).toBeUndefined();
	});

	it('changes nothing on re-importing the same collection', () => {
		const first = planImport(two, () => undefined);
		const byWord = new Map(first.set.map((entry) => [entry.word, entry]));
		const again = { ...two, exportedAt: '2026-09-28T20:00:00Z' };
		const plan = planImport(again, (word) => ({
			state: byWord.get(word)!.level,
			provenance: byWord.get(word)!.provenance
		}));
		expect(plan.set).toEqual([]);
		expect(plan.unchanged).toBe(5);
	});

	it('writes the review date a format-1 import lacked, over the same stability', () => {
		const plan = planImport(two, (word) => {
			const entry = one.words.find((w) => w.word === word)!;
			return { state: entry.level, provenance: ankiProvenance(one.exportedAt, entry) };
		});
		expect(plan.set.map((entry) => entry.word)).toEqual(['将来', '关税', '违法', '朋友']);
	});
});

describe('the parameters an import brings', () => {
	it('are recorded once, with the import, and again only when they change', async () => {
		const { Repository } = await import('../../src/lib/storage/repository');
		const { freshDatabase } = await import('../storage/support');
		const { queryRows } = await import('../../src/lib/storage/db');
		const db = await freshDatabase();
		const repository = new Repository(db);
		const recorded = () =>
			queryRows(db, `SELECT detail FROM encounter WHERE kind = 'anki-parameters' ORDER BY id`).map(
				(row) => JSON.parse(String(row.detail))
			);

		repository.importAnki(two);
		repository.importAnki({ ...two, exportedAt: '2026-09-28T20:00:00Z' });
		expect(recorded()).toEqual([{ ...two.parameters, importId: ID }]);

		const refitted = { ...two.parameters!, weights: two.parameters!.weights.map((w) => w * 1.01) };
		repository.importAnki({ ...two, exportedAt: '2026-10-05T20:00:00Z', parameters: refitted });
		expect(recorded()).toHaveLength(2);
		expect(recorded()[1].importId).toBe('2026-10-05T20:00:00Z');
	});

	it('are nothing for a format-1 file', async () => {
		const { Repository } = await import('../../src/lib/storage/repository');
		const { freshDatabase } = await import('../storage/support');
		const { queryRows } = await import('../../src/lib/storage/db');
		const db = await freshDatabase();
		new Repository(db).importAnki(one);
		expect(queryRows(db, `SELECT * FROM encounter`)).toEqual([]);
	});
});
