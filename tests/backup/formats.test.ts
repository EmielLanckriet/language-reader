import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { Repository } from '../../src/lib/storage/repository';
import { open } from '../../src/lib/backup/format';
import { freshDatabase } from '../storage/support';

// Every copy format ever written must still restore (SC-005). A fixture of each is kept forever in
// tests/fixtures/copies/; adding a format means adding its fixture, never replacing an old one.

const fixtures = readdirSync('tests/fixtures/copies').filter((name) =>
	/^format-\d+\.json$/.test(name)
);

describe('copies written by every earlier format', () => {
	const OLD = new Set(['ignored', 'learning', 'known', 'unknown', 'retired']);

	it('has a fixture for at least format 1', () => {
		expect(fixtures).toContain('format-1.json');
	});

	for (const name of fixtures) {
		it(`restores ${name} with every mark intact`, async () => {
			const body = await open(readFileSync(`tests/fixtures/copies/${name}`, 'utf-8'));
			const target = new Repository(await freshDatabase());
			target.restoreCopy(body);

			// Every mark but those the switch to statuses deletes (spec 019, FR-017), which a copy
			// from before it gets on restore: hand marks, `ignored`, `retired`, and a (none) undoing one.
			const kept: typeof body.events = [];
			const last = new Map<string, string>();
			for (const event of [...body.events].sort((a, b) =>
				a.deviceId === b.deviceId ? a.deviceSeq - b.deviceSeq : a.deviceId < b.deviceId ? -1 : 1
			)) {
				const word = `${event.language} ${event.surface}`;
				const before = last.get(word);
				last.set(word, event.asserted);
				if (OLD.has(event.asserted) || (event.asserted === '(none)' && before && OLD.has(before)))
					continue;
				kept.push(event);
			}
			const restored = target.exportBody('test', 'now');
			expect(restored.events.map((e) => [e.surface, e.asserted, e.deviceSeq])).toEqual(
				kept.map((e) => [e.surface, e.asserted, e.deviceSeq])
			);
			// Statuses (format 4) come back exactly; an older copy gets those the switch writes.
			if (body.statuses.length > 0)
				expect(restored.statuses.map((c) => [c.surface, c.status, c.cause, c.deviceSeq])).toEqual(
					body.statuses.map((c) => [c.surface, c.status, c.cause, c.deviceSeq])
				);
			expect(restored.documents.map((document) => document.rawContent)).toEqual(
				body.documents.map((document) => document.rawContent)
			);
		});
	}
});
