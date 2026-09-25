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
	it('has a fixture for at least format 1', () => {
		expect(fixtures).toContain('format-1.json');
	});

	for (const name of fixtures) {
		it(`restores ${name} with every mark intact`, async () => {
			const body = await open(readFileSync(`tests/fixtures/copies/${name}`, 'utf-8'));
			const target = new Repository(await freshDatabase());
			target.restoreCopy(body);

			const restored = target.exportBody('test', 'now');
			expect(restored.states).toEqual(body.states);
			expect(restored.events).toHaveLength(body.events.length);
			expect(restored.documents.map((document) => document.rawContent)).toEqual(
				body.documents.map((document) => document.rawContent)
			);
		});
	}
});
