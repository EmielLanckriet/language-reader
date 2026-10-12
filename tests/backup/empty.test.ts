import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { holdsNothing, type CopyBody } from '../../src/lib/backup/format';
import { freshDatabase } from '../storage/support';
import { buildHistory } from './support';

// A copy of an empty library is not sent (issue #22): sent, it became Termux's newest copy and the
// library offered to restore "0 documents and 0 marked words" in front of the copy worth having.

const at = '2026-10-12T10:00:00.000Z';
const EARNED = ['documents', 'events', 'states', 'sessions', 'encounters', 'corrections'] as const;

describe('a copy that holds nothing', () => {
	it('is what a fresh library exports', async () => {
		expect(holdsNothing(new Repository(await freshDatabase()).exportBody('test', at))).toBe(true);
	});

	it('is not a library with one document and no marks', async () => {
		const repository = new Repository(await freshDatabase());
		await buildHistory(repository, ['我看书'], []);
		expect(holdsNothing(repository.exportBody('test', at))).toBe(false);
	});

	it('is not a copy with anything earned, whichever list holds it', async () => {
		const empty = new Repository(await freshDatabase()).exportBody('test', at);
		for (const list of EARNED)
			expect(holdsNothing({ ...empty, [list]: [{}] } as unknown as CopyBody), list).toBe(false);
	});
});
