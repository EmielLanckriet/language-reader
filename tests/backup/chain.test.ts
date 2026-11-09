import { describe, it, expect } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { freshDatabase } from '../storage/support';
import { buildHistory } from './support';
import { run } from '../../src/lib/storage/db';
import { RETRACTED } from '../../src/lib/domain/state';
import {
	canonical,
	mergeChain,
	trimDocuments,
	type CopyBody,
	type CopyDocument
} from '../../src/lib/backup/format';

// Copies as a chain (ADR-0048, after Sapling): one full copy, then increments holding only what
// was added since. Merged, they must be exactly the full copy a library would export at the end.

const parts = (...surfaces: string[]) => surfaces.map((surface) => ({ surface, key: surface }));

/** Everything a reader does that writes history: marks, a session, a review, a status, a correction. */
async function work(repository: Repository, ids: number[], text: string, round: number) {
	const [id] = await buildHistory(
		repository,
		[text],
		[
			{ document: 0, word: round, state: 'anki-young' },
			{ document: 0, word: round + 1, state: 'anki-mature' }
		]
	);
	const token = repository.getDocument(id).tokens.find((t) => t.isWord)!;
	const session = repository.startSession(ids[0] ?? id, 'media');
	const at = `2026-11-0${round + 1}T10:00:00Z`;
	repository.recordEncounters(session, [
		{
			kind: 'played',
			at,
			documentId: id,
			fromOffset: 0,
			toOffset: 3,
			mediaMs: 0,
			textVisible: true,
			detail: { toMs: 4000 }
		},
		{
			kind: 'lookup',
			lexemeId: token.lexemeId!,
			at,
			documentId: id,
			fromOffset: token.start,
			toOffset: token.end,
			detail: {}
		},
		{ kind: 'session-end', at }
	]);
	repository.recordReview(token.lexemeId!, 3, undefined, at);
	repository.setStatus(token.lexemeId!, round % 2 ? 'ignored' : 'retired');
	repository.correct('zh', `华崑${round}`.slice(0, 2), parts('华', '崑'), {
		documentId: id,
		fromOffset: 0,
		toOffset: 0
	});
	return id;
}

/** What the page compares to tell a changed document; here simply its whole content. */
const marksOf = (documents: CopyDocument[]) =>
	Object.fromEntries(documents.map((d) => [d.id, canonical(d)]));

/** A full export without the fields that only say when and by which build it was made. */
const content = (body: CopyBody) => ({ ...body, createdAt: '', app: '' });

describe('a chain of copies', () => {
	it('merges a full copy and its increments into exactly the full copy at the end', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		const ids = [await work(repository, [], '我们今天学习中文', 0)];
		// A restored library holds rows of an earlier device, sorting after (or before) the writer.
		run(db, 'INSERT INTO device (id, next_seq) VALUES (?, 2)', ['zzzz-earlier-device']);
		run(
			db,
			`INSERT INTO correction_event (language, form, parts, made_at, device_id, device_seq)
       VALUES ('zh', '中文', NULL, '2026-10-01T00:00:00Z', 'zzzz-earlier-device', 1)`
		);
		const marked = repository.getDocument(ids[0]).tokens.filter((t) => t.isWord)[0].lexemeId!;
		const base = repository.exportCopy('app', '2026-11-01T00:00:00Z');

		ids.push(await work(repository, ids, '他们明天去北京', 1));
		repository.removeDocument(ids[0]);
		repository.assertState(marked, RETRACTED); // a state that goes away
		const first = repository.exportIncrement('app', '2026-11-02T00:00:00Z', base.cursor)!;
		expect(first).not.toBeNull();

		ids.push(await work(repository, ids, '你喜欢喝茶吗', 2));
		const second = repository.exportIncrement('app', '2026-11-03T00:00:00Z', first.cursor)!;

		// The page sends a document's text only when it changed since the piece before.
		const sent = trimDocuments(
			marksOf(base.body.documents),
			first.increment,
			marksOf(first.increment.documents)
		);
		const sentAgain = trimDocuments(
			sent.sent,
			second.increment,
			marksOf(second.increment.documents)
		);
		expect(sentAgain.increment.documents.length).toBe(1); // only the new one
		expect(sentAgain.increment.documentIds.length).toBe(3);

		const merged = mergeChain(base.body, [sent.increment, sentAgain.increment]);
		expect(content(merged)).toEqual(content(repository.exportBody('app', 'now')));
	});

	it('sends only what was added: an increment after nothing new holds no history', async () => {
		const repository = new Repository(await freshDatabase());
		await work(repository, [], '我们今天学习中文', 0);
		const base = repository.exportCopy('app', '2026-11-01T00:00:00Z');
		const next = repository.exportIncrement('app', '2026-11-02T00:00:00Z', base.cursor)!;
		const { events, sessions, encounters, corrections, statuses, states } = next.increment;
		expect(
			[events, sessions, encounters, corrections, statuses, states].map((x) => x.length)
		).toEqual([0, 0, 0, 0, 0, 0]);
	});

	it('refuses an increment once history was deleted, so a full copy is sent instead', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		await work(repository, [], '我们今天学习中文', 0);
		const base = repository.exportCopy('app', '2026-11-01T00:00:00Z');
		run(db, 'DELETE FROM encounter WHERE kind = ?', ['lookup']);
		expect(repository.exportIncrement('app', '2026-11-02T00:00:00Z', base.cursor)).toBeNull();
	});

	it('refuses to merge pieces that do not follow each other', async () => {
		const repository = new Repository(await freshDatabase());
		await work(repository, [], '我们今天学习中文', 0);
		const base = repository.exportCopy('app', '2026-11-01T00:00:00Z');
		await work(repository, [], '他们明天去北京', 1);
		const first = repository.exportIncrement('app', '2026-11-02T00:00:00Z', base.cursor)!;
		const second = repository.exportIncrement('app', '2026-11-03T00:00:00Z', first.cursor)!;
		expect(() => mergeChain(base.body, [second.increment])).toThrow();
		expect(() => mergeChain(base.body, [first.increment, first.increment])).toThrow();
	});

	it('keeps the media a document had when a later piece sends it without (a wiped folder, #58)', async () => {
		const repository = new Repository(await freshDatabase());
		await work(repository, [], '我们今天学习中文', 0);
		const base = repository.exportCopy('app', '2026-11-01T00:00:00Z');
		const [kept, removed] = [0, 0].map(() => ({ ...base.body.documents[0] }));
		const media = {
			subtitles: { name: 'media.zh.vtt', text: 'WEBVTT' },
			meta: { id: 'x' },
			files: [{ name: 'layout.json', text: '{}' }]
		};
		base.body.documents = [
			{ ...kept, id: 101, media },
			{ ...removed, id: 102, media }
		];
		const next = repository.exportIncrement('app', '2026-11-02T00:00:00Z', base.cursor)!;
		next.increment.documentIds = [101, 102];
		next.increment.documents = [
			{ ...kept, id: 101 },
			{ ...removed, id: 102, removedAt: '2026-11-02T00:00:00Z' }
		];
		const merged = mergeChain(base.body, [next.increment]);
		expect(merged.documents.map((d) => d.media)).toEqual([media, undefined]);
	});
});
