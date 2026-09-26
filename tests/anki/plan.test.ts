import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAnkiExport, planImport, ankiProvenance } from '../../src/lib/domain/anki';

// What an import writes for each word (spec 006, research R6). The reader's own judgment always
// wins; an unchanged Anki word writes nothing; everything else takes Anki's level.

const file = parseAnkiExport(readFileSync('tests/fixtures/anki/anki-words.json', 'utf8'));
const ID = file.exportedAt;

describe('planning an Anki import', () => {
	it('sets every word that has no state', () => {
		const plan = planImport(file, () => undefined);
		expect(plan.set.map((entry) => [entry.word, entry.level])).toEqual([
			['将来', 'anki-long-term'],
			['关税', 'anki-mature'],
			['政策', 'anki-young'],
			['违法', 'anki-learning'],
			['朋友', 'anki-mature']
		]);
		expect(plan.set[0].provenance).toBe(`anki ${ID} s=983.7`);
	});

	it('leaves every word the reader judged themselves, whatever Anki says', () => {
		const plan = planImport(file, (word) =>
			word === '关税' ? { state: 'known', provenance: 'manual' } : undefined
		);
		expect(plan.set.map((entry) => entry.word)).not.toContain('关税');
		expect(plan.keptOwn).toEqual(['关税']);
	});

	it('writes nothing for a word Anki has not changed, and the new level for one it has', () => {
		const earlier = 'anki 2026-09-01T00:00:00Z';
		const plan = planImport(file, (word) => {
			if (word === '将来')
				return { state: 'anki-long-term', provenance: ankiProvenance(earlier, 983.7) };
			if (word === '政策')
				return { state: 'anki-learning', provenance: ankiProvenance(earlier, 3) };
			return { state: 'anki-mature', provenance: ankiProvenance(earlier, 64.2) };
		});
		expect(plan.set.map((entry) => entry.word)).toEqual(['政策', '违法', '朋友']);
		expect(plan.unchanged).toBe(2);
	});

	it('refuses a file of another format, saying so', () => {
		expect(() => parseAnkiExport(JSON.stringify({ ...file, format: 2 }))).toThrow(/format 2/);
	});
});
