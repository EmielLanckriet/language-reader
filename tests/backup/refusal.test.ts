import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { open, seal } from '../../src/lib/backup/format';
import { freshDatabase } from '../storage/support';
import { buildHistory, dump } from './support';

// A restore must never discard work newer than the copy (FR-010). Any mark means the library is
// in use, and the restore refuses; documents alone are not marks, and the copy joins them.

async function copyText() {
	const source = new Repository(await freshDatabase());
	await buildHistory(source, ['我看书'], [{ document: 0, word: 0, state: 'known' }]);
	return JSON.stringify(await seal(source.exportBody('test', 'now')));
}

describe('restoring into a library already in use', () => {
	it('refuses when any mark exists, and writes nothing', async () => {
		const db = await freshDatabase();
		const target = new Repository(db);
		await buildHistory(target, ['你好'], [{ document: 0, word: 0, state: 'learning' }]);
		const before = dump(db);
		const body = await open(await copyText());

		expect(() => target.restoreCopy(body)).toThrow(expect.objectContaining({ check: 'not-empty' }));
		expect(dump(db)).toBe(before);
	});

	it('joins documents that carry no marks, pointing events at the renumbered documents', async () => {
		const target = new Repository(await freshDatabase());
		await buildHistory(target, ['你好'], []);
		target.restoreCopy(await open(await copyText()));

		const body = target.exportBody('test', 'now');
		expect(body.documents.map((document) => document.rawContent)).toEqual(['你好', '我看书']);
		expect(body.events).toHaveLength(1);
		expect(body.events[0].documentId).toBe(body.documents[1].id);
		expect(body.states).toEqual([
			{ language: 'zh', surface: '我', state: 'known', provenance: 'manual', userId: 1 }
		]);
	});
});
