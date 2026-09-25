import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { Repository } from '../../src/lib/storage/repository';
import { open, seal } from '../../src/lib/backup/format';
import { freshDatabase } from '../storage/support';
import { run } from '../../src/lib/storage/db';
import { buildHistory, STATES } from './support';

// A copy is only worth keeping if restoring it gives back exactly what was copied (FR-007).
// Exported again after a restore, the reader's work must be identical: the same events in the
// same order with the same devices, sequence numbers and occurrences, the same states, the same
// documents. Generated histories, because the interesting input is whatever the reader happened to do.

const history = fc.record({
	texts: fc.array(
		fc.string({ unit: fc.constantFrom(...'我你他好书看学中文'), minLength: 1, maxLength: 6 }),
		{
			minLength: 1,
			maxLength: 3
		}
	),
	marks: fc.array(
		fc.record({ document: fc.nat(), word: fc.nat(), state: fc.constantFrom(...STATES) }),
		{ maxLength: 15 }
	)
});

describe('a copy restores exactly what it holds', () => {
	it('export → restore → export gives the same body', async () => {
		await fc.assert(
			fc.asyncProperty(history, async ({ texts, marks }) => {
				const source = new Repository(await freshDatabase());
				await buildHistory(source, texts, marks);
				const body = source.exportBody('test', '2026-09-25T00:00:00.000Z');

				const target = new Repository(await freshDatabase());
				target.restoreCopy(await open(JSON.stringify(await seal(body))));

				expect(target.exportBody('test', '2026-09-25T00:00:00.000Z')).toEqual(body);
			}),
			{ numRuns: 40 }
		);
	});

	it('carries on as the same device, so a new mark continues its sequence', async () => {
		const source = new Repository(await freshDatabase());
		await buildHistory(source, ['我看书'], [{ document: 0, word: 1, state: 'learning' }]);
		const body = source.exportBody('test', 'now');

		const target = new Repository(await freshDatabase());
		target.restoreCopy(await open(JSON.stringify(await seal(body))));
		// Restored documents have no tokens until opened, so the word is found by its surface.
		const lexeme = target.findOrCreateLexeme('zh', body.events[0].surface);
		target.assertState(lexeme, 'known');

		const events = target.exportBody('test', 'now').events;
		expect(events.map((event) => [event.deviceId, event.deviceSeq])).toEqual([
			[body.writer, 1],
			[body.writer, 2]
		]);
	});

	it('replaces a device the fresh install made but never used', async () => {
		const source = new Repository(await freshDatabase());
		await buildHistory(source, ['我看书'], [{ document: 0, word: 0, state: 'known' }]);
		const body = source.exportBody('test', 'now');

		const db = await freshDatabase();
		run(db, "INSERT INTO device (id, next_seq) VALUES ('0-unused-fresh-device', 1)");
		const target = new Repository(db);
		target.restoreCopy(await open(JSON.stringify(await seal(body))));

		expect(target.exportBody('test', 'now').writer).toBe(body.writer);
	});
});
