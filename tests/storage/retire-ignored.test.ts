import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';

// ADR-0040: ignoring is no longer offered, so words already ignored become retired once the app
// opens: they regain their memory and stay out of the deck. Appended marks; the history keeps both.

describe('retiring ignored words', () => {
	it('retires each ignored word once, gives it back its memory, and leaves other marks alone', async () => {
		const repository = new Repository(await freshDatabase());
		const [id] = await buildHistory(repository, ['我看书。'], []);
		const words = repository.getDocument(id).tokens.filter((t) => t.isWord);
		const [ignored, learning] = words.map((t) => t.lexemeId!);
		repository.recordReview(ignored, 3, undefined, '2026-10-01T10:00:00Z');
		repository.assertState(ignored, 'ignored');
		repository.assertState(learning, 'learning');
		expect(repository.getMemory([ignored]).memory.get(ignored)).toBeUndefined();

		expect(repository.retireIgnored()).toBe(1);
		const states = repository.getStates([ignored, learning]);
		expect(states.get(ignored)?.state).toBe('retired');
		expect(states.get(learning)?.state).toBe('learning');
		const reading = repository.getMemory([ignored]).memory.get(ignored)?.reading;
		expect(reading).toBeDefined();
		expect(reading?.card).toBe(false);
		expect(
			repository
				.readHistory()
				.filter((e) => e.lexemeId === ignored)
				.map((e) => e.asserted)
		).toEqual(['ignored', 'retired']);

		expect(repository.retireIgnored()).toBe(0);
	});
});
