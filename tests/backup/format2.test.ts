import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { open, seal, upgrade, type CopyBody } from '../../src/lib/backup/format';
import { freshDatabase } from '../storage/support';
import { buildHistory, dump } from './support';

// Copy format 2 carries sessions and encounters (contracts/formats.md), which are earned data: a
// copy that loses them loses what no fold recovers.

const at = '2026-09-27T10:00:00.000Z';

async function libraryWithEncounters() {
	const repository = new Repository(await freshDatabase());
	const [first, second] = await buildHistory(
		repository,
		['我看书', '你好吗'],
		[{ document: 0, word: 0, state: 'learning' }]
	);
	const word = repository.getDocument(second).tokens.find((token) => token.isWord)!;
	const session = repository.startSession(second, 'media');
	repository.recordEncounters(session, [
		{
			kind: 'played',
			at,
			documentId: second,
			fromOffset: 0,
			toOffset: 3,
			mediaMs: 0,
			speed: 1,
			textVisible: true,
			detail: { toMs: 5000 }
		},
		{
			kind: 'lookup',
			at,
			lexemeId: word.lexemeId,
			documentId: second,
			fromOffset: word.start,
			toOffset: word.end,
			mediaMs: 4000,
			speed: 1,
			textVisible: true
		},
		{ kind: 'attention', at, detail: { answer: 'all' } }
	]);
	repository.startSession(first, 'reading');
	return repository;
}

describe('copy format 2', () => {
	it('reads a format-1 copy as one with no sessions and no encounters', () => {
		const one = {
			format: 1,
			app: 'a',
			createdAt: at,
			writer: 'd',
			devices: [],
			documents: [],
			events: [],
			states: [],
			corrections: []
		};
		expect(upgrade(one as unknown as CopyBody)).toMatchObject({
			format: 3,
			sessions: [],
			encounters: []
		});
	});

	it('export → restore → export gives the same sessions and encounters', async () => {
		const source = await libraryWithEncounters();
		const body = source.exportBody('test', at);
		expect(body.sessions).toHaveLength(2);
		expect(body.encounters.map((encounter) => encounter.kind)).toEqual([
			'played',
			'lookup',
			'attention'
		]);
		expect(body.encounters[1]).toMatchObject({ surface: '你', from: 0, to: 1, mediaMs: 4000 });

		const target = new Repository(await freshDatabase());
		target.restoreCopy(await open(JSON.stringify(await seal(body))));

		expect(target.exportBody('test', at)).toEqual(body);
	});

	it('refuses to restore over a library that holds only encounters, and writes nothing', async () => {
		const body = (await libraryWithEncounters()).exportBody('test', at);
		const db = await freshDatabase();
		const target = new Repository(db);
		const [id] = await buildHistory(target, ['他'], []);
		target.startSession(id, 'reading');
		const before = dump(db);

		expect(() => target.restoreCopy(body)).toThrow(/already/);
		expect(dump(db)).toBe(before);
	});

	it('refuses an encounter that points at a document the copy does not hold', async () => {
		const body = (await libraryWithEncounters()).exportBody('test', at);
		body.encounters[0].documentId = 999;
		const target = new Repository(await freshDatabase());
		expect(() => target.restoreCopy(body)).toThrow(/points at nothing/);
	});
});
