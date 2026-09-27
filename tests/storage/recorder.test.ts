import { describe, it, expect } from 'vitest';
import { Recorder, recoverUnsent } from '../../src/lib/ui/recorder';
import { Repository } from '../../src/lib/storage/repository';
import { queryRows } from '../../src/lib/storage/db';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';

// One plumbing test (CLAUDE.md): the recorder, driven as the stage drives it, writes what happened
// and writes it once.

describe('the recorder', () => {
	it('writes a lookup, a check, a replay and the played stretches in order, each once', async () => {
		const db = await freshDatabase();
		const repository = new Repository(db);
		const [documentId] = await buildHistory(repository, ['我看书\n你好'], []);
		const words = repository.getDocument(documentId).tokens.filter((token) => token.isWord);
		const sink = {
			startSession: async (id: number, modality: 'reading' | 'media') =>
				repository.startSession(id, modality),
			recordEncounters: async (
				session: number,
				encounters: Parameters<Repository['recordEncounters']>[1]
			) => repository.recordEncounters(session, encounters)
		};
		let clock = Date.parse('2026-09-27T10:00:00Z');
		const recorder = new Recorder(
			sink,
			documentId,
			'media',
			[
				[0, 3],
				[4, 6]
			],
			() => clock
		);
		const moment = (ms: number) => ({ mediaMs: ms, speed: 1, textVisible: true });
		const word = (i: number) => ({
			lexemeId: words[i].lexemeId!,
			fromOffset: words[i].start,
			toOffset: words[i].end
		});

		for (let ms = 0; ms <= 6000; ms += 250) recorder.playing(0, moment(ms));
		recorder.opened(word(0), moment(6000));
		recorder.closed();
		await recorder.flush();
		for (let ms = 6000; ms <= 12000; ms += 250) recorder.playing(1, moment(ms));
		recorder.replay(1, false, 12000);
		recorder.opened(word(3), moment(12000));
		recorder.closed({ knew: 'knew' });
		clock += 1000;
		await recorder.close();
		await recorder.flush();

		const rows = queryRows(
			db,
			'SELECT kind, lexeme_id, media_ms, detail FROM encounter ORDER BY device_seq'
		);
		expect(rows.map((row) => row.kind)).toEqual(['played', 'lookup', 'played', 'replay', 'check']);
		expect(rows[0]).toMatchObject({ media_ms: 0, detail: '{"toMs":6000}' });
		expect(rows[2]).toMatchObject({ media_ms: 6000, detail: '{"toMs":12000}' });
		expect(rows[4]).toMatchObject({ lexeme_id: words[3].lexemeId!, detail: '{"via":"knew"}' });
		expect(queryRows(db, 'SELECT COUNT(*) AS n FROM session')[0].n).toBe(1);
	});

	it('keeps what it could not write yet, for a later start to write once, if the app is killed', async () => {
		const kept = new Map<string, string>();
		globalThis.localStorage = {
			getItem: (key: string) => kept.get(key) ?? null,
			setItem: (key: string, value: string) => void kept.set(key, value),
			removeItem: (key: string) => void kept.delete(key),
			key: (i: number) => [...kept.keys()][i] ?? null,
			get length() {
				return kept.size;
			},
			clear: () => kept.clear()
		} as Storage;
		const db = await freshDatabase();
		const repository = new Repository(db);
		const [documentId] = await buildHistory(repository, ['我看书\n你好'], []);
		let clock = Date.parse('2026-09-27T10:00:00Z');
		// Screen locked: the lease is gone, so a write never completes.
		const locked = {
			startSession: () => new Promise<number>(() => {}),
			recordEncounters: () => new Promise<void>(() => {})
		};
		const recorder = new Recorder(
			locked,
			documentId,
			'media',
			[
				[0, 3],
				[4, 6]
			],
			() => clock
		);
		for (let ms = 0; ms <= 6000; ms += 250)
			recorder.playing(0, { mediaMs: ms, speed: 1, textVisible: false });
		void recorder.flush();
		for (let ms = 6000; ms <= 9000; ms += 250)
			recorder.playing(1, { mediaMs: ms, speed: 1, textVisible: false });
		void recorder.flush();

		const sink = {
			startSession: async (id: number, modality: 'reading' | 'media') =>
				repository.startSession(id, modality),
			recordEncounters: async (
				session: number,
				encounters: Parameters<Repository['recordEncounters']>[1]
			) => repository.recordEncounters(session, encounters)
		};
		// Too recent: still a live recorder's.
		expect(await recoverUnsent(sink, () => clock + 10_000)).toBe(0);
		// The app was killed; a later start writes it, once.
		clock += 120_000;
		expect(await recoverUnsent(sink, () => clock)).toBe(2);
		expect(await recoverUnsent(sink, () => clock)).toBe(0);
		const rows = queryRows(
			db,
			'SELECT kind, text_visible, detail FROM encounter ORDER BY device_seq'
		);
		expect(rows).toEqual([
			{ kind: 'played', text_visible: 0, detail: '{"toMs":6000}' },
			{ kind: 'played', text_visible: 0, detail: '{"toMs":9000}' }
		]);
	});
});
