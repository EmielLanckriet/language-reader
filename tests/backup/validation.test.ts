import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { CopyRejected, open, seal, type CopyBody } from '../../src/lib/backup/format';
import { freshDatabase } from '../storage/support';
import { buildHistory, dump } from './support';

// A damaged copy must be refused before anything is written (FR-008): the store afterwards is
// identical, row for row, to the store before.

async function sample(): Promise<CopyBody> {
	const source = new Repository(await freshDatabase());
	await buildHistory(
		source,
		['我看书', '他学中文'],
		[
			{ document: 0, word: 1, state: 'learning' },
			{ document: 1, word: 2, state: 'known' }
		]
	);
	return source.exportBody('test', 'now');
}

async function refusedWithoutWriting(text: string, check: string) {
	const db = await freshDatabase();
	const target = new Repository(db);
	const before = dump(db);
	const attempt = (async () => target.restoreCopy(await open(text)))();
	await expect(attempt).rejects.toSatisfy(
		(error) => error instanceof CopyRejected && error.check === check
	);
	expect(dump(db)).toBe(before);
}

describe('a damaged copy changes nothing', () => {
	it('refuses a copy with one character changed', async () => {
		const text = JSON.stringify(await seal(await sample()));
		await refusedWithoutWriting(text.replace('"learning"', '"learninh"'), 'integrity');
	});

	it('refuses a truncated copy', async () => {
		const text = JSON.stringify(await seal(await sample()));
		await refusedWithoutWriting(text.slice(0, text.length / 2), 'parse');
	});

	it('refuses a format it does not know', async () => {
		const text = JSON.stringify(await seal({ ...(await sample()), format: 99 }));
		await refusedWithoutWriting(text, 'format');
	});

	it('refuses an event naming a document the copy lacks, and rolls back', async () => {
		const body = await sample();
		body.events[1] = { ...body.events[1], documentId: 999 };
		await refusedWithoutWriting(JSON.stringify(await seal(body)), 'references');
	});

	it('refuses a copy whose states disagree with its history, and rolls back', async () => {
		const body = await sample();
		body.states[0] = {
			...body.states[0],
			state: body.states[0].state === 'known' ? 'learning' : 'known'
		};
		await refusedWithoutWriting(JSON.stringify(await seal(body)), 'states');
	});
});
