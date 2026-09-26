import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { projectStates, RETRACTED } from '../../src/lib/domain/state';
import type { HistoryEntry } from '../../src/lib/domain/types';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from '../storage/support';
import { buildHistory } from '../backup/support';

// A retraction (ADR-0024) is the one event that says "never judged" again. Undoing an Anki import
// needs it for words the import marked from nothing. Whatever came before, a retraction as a word's
// last event leaves it with no state, and a later judgment gives it one again.

const entries = fc
	.array(
		fc.record({
			lexemeId: fc.integer({ min: 1, max: 4 }),
			asserted: fc.constantFrom('known', 'learning', 'anki-mature', RETRACTED)
		}),
		{ maxLength: 30 }
	)
	.map((events) =>
		events.map((event, i): HistoryEntry => ({
			...event,
			assertedAt: 'now',
			deviceId: 'd',
			deviceSeq: i + 1,
			provenance: 'manual',
			userId: 1
		}))
	);

describe('a retraction', () => {
	it('leaves a word with no state exactly when it is the word’s last event', () => {
		fc.assert(
			fc.property(entries, (history) => {
				const states = projectStates(history);
				for (const lexemeId of [1, 2, 3, 4]) {
					const last = history.filter((entry) => entry.lexemeId === lexemeId).at(-1);
					if (!last || last.asserted === RETRACTED) expect(states.has(lexemeId)).toBe(false);
					else expect(states.get(lexemeId)?.state).toBe(last.asserted);
				}
			})
		);
	});

	it('is honoured by the stored states when the projection is rebuilt, and a copy agrees', async () => {
		const repository = new Repository(await freshDatabase());
		const [id] = await buildHistory(
			repository,
			['我看书'],
			[{ document: 0, word: 0, state: 'known' }]
		);
		const word = repository.getDocument(id).tokens.find((token) => token.isWord)!.lexemeId!;

		repository.assertState(word, RETRACTED);
		repository.rebuildProjection();

		expect(repository.getStates([word]).size).toBe(0);
		expect(repository.exportBody('test', 'now').states).toEqual([]);
	});
});
