import { expect, it } from 'vitest';
import { Repository } from '../../src/lib/storage/repository';
import { Recorder } from '../../src/lib/ui/recorder';
import { freshDatabase } from './support';
import { buildHistory } from '../backup/support';
import { queryRows } from '../../src/lib/storage/db';
import { seal, open } from '../../src/lib/backup/format';

it('measures listening time at playback speed and never credits a seek', async () => {
	const events: Parameters<Repository['recordEncounters']>[1] = [];
	let clock = Date.parse('2026-09-30T10:00:00Z');
	const recorder = new Recorder(
		{
			startSession: async () => 1,
			recordEncounters: async (_id, batch) => {
				events.push(...batch);
			}
		},
		1,
		'media',
		[[0, 2]],
		() => clock
	);
	for (let ms = 0; ms <= 6000; ms += 250) {
		recorder.playing(0, { mediaMs: ms, speed: 2, textVisible: false });
		clock += 125;
	}
	recorder.paused();
	recorder.seek(6000, 100000);
	clock += 30000;
	await recorder.close();
	expect(
		events
			.filter((e) => e.kind === 'study-time')
			.reduce((n, e) => n + Number(e.detail?.durationMs), 0)
	).toBe(3000);
});

it('does not lose milliseconds between clock reads at the daily threshold', async () => {
	let clock = Date.parse('2026-09-30T10:00:00Z');
	const events: Parameters<Repository['recordEncounters']>[1] = [];
	const recorder = new Recorder(
		{
			startSession: async () => 1,
			recordEncounters: async (_id, batch) => {
				events.push(...batch);
			}
		},
		1,
		'reading',
		[],
		() => clock++
	);
	recorder.read(0, 2);
	for (let i = 0; i < 14; i++) {
		clock += 5000;
		await recorder.flush();
	}
	await recorder.close();
	expect(
		events
			.filter((e) => e.kind === 'study-time')
			.reduce((n, e) => n + Number(e.detail?.durationMs), 0)
	).toBe(60000);
});

it('keeps feedback across reopen, appends corrections, excludes withdrawals and rewards honest failures', async () => {
	const db = await freshDatabase();
	try {
		let repo = new Repository(db);
		const [id] = await buildHistory(repo, ['你好'], []);
		const session = repo.startSession(id, 'reading');
		const at = '2026-09-30T10:00:00Z';
		repo.recordEncounters(session, [
			{ kind: 'study-time', at, detail: { durationMs: 60000 } },
			{ kind: 'session-end', at }
		]);
		repo = new Repository(db);
		let overview = repo.studyOverview('Europe/Brussels', new Date(at));
		expect(overview.sessions[0]).toMatchObject({ id: session, answered: false, activityMs: 60000 });
		expect(overview.week.completed).toBe(1);
		for (const answer of ['all', 'some', null])
			repo.recordEncounters(session, [{ kind: 'attention', at, detail: { answer } }]);
		overview = repo.studyOverview('Europe/Brussels', new Date(at));
		expect(overview.sessions[0]).toMatchObject({ answered: true, answer: null });
		expect(queryRows(db, "SELECT * FROM encounter WHERE kind='attention'")).toHaveLength(3);
		const restoredDb = await freshDatabase();
		try {
			const copy = repo.exportBody('test', at);
			const restored = new Repository(restoredDb);
			restored.restoreCopy(await open(JSON.stringify(await seal(copy))));
			expect(restored.exportBody('test', at)).toEqual(copy);
			expect(restored.studyOverview('Europe/Brussels', new Date(at)).week.completed).toBe(1);
		} finally {
			restoredDb.close();
		}
		repo.withdrawSession(session, 'test');
		expect(repo.studyOverview('Europe/Brussels', new Date(at)).week.completed).toBe(0);
		expect(repo.studyOverview('Europe/Brussels', new Date(at)).sessions).toHaveLength(0);
		const word = repo.getDocument(id).tokens.find((t) => t.isWord)!;
		for (let n = 0; n < 5; n++) repo.recordReview(word.lexemeId!, 1, undefined, at);
		expect(repo.studyOverview('Europe/Brussels', new Date(at)).week.completed).toBe(1);
	} finally {
		db.close();
	}
});

it('keeps how a session was taken in beside its lookup answer, changing neither memory nor its end', async () => {
	const db = await freshDatabase();
	try {
		const repo = new Repository(db);
		const [id] = await buildHistory(repo, ['你好'], []);
		const session = repo.startSession(id, 'media');
		const at = '2026-10-04T10:00:00Z';
		const later = '2026-10-04T18:00:00Z';
		repo.recordEncounters(session, [
			{
				kind: 'played',
				at,
				documentId: id,
				fromOffset: 0,
				toOffset: 2,
				mediaMs: 0,
				textVisible: false,
				detail: { toMs: 40000 }
			},
			{ kind: 'session-end', at },
			{ kind: 'attention', at, detail: { answer: 'all' } }
		]);
		const memory = () => queryRows(db, 'SELECT * FROM memory ORDER BY lexeme_id, skill');
		const before = memory();
		repo.recordEncounters(session, [
			{ kind: 'engagement', at: later, detail: { mode: 'watched', attentive: null } },
			{ kind: 'engagement', at: later, detail: { mode: 'listened', attentive: 'partly' } }
		]);
		expect(memory()).toEqual(before);
		expect(repo.studyOverview('Europe/Brussels', new Date(later)).sessions[0]).toMatchObject({
			answer: 'all',
			lastAt: at,
			engagement: { mode: 'listened', attentive: 'partly' }
		});
	} finally {
		db.close();
	}
});

it('records only visible non-idle reading time and closes once, with recoverable write errors', async () => {
	let clock = Date.parse('2026-09-30T10:00:00Z');
	const events: Parameters<Repository['recordEncounters']>[1] = [];
	let fail = false;
	const recorder = new Recorder(
		{
			startSession: async () => 1,
			recordEncounters: async (_id, batch) => {
				if (fail) throw new Error('offline');
				events.push(...batch);
			}
		},
		1,
		'reading',
		[],
		() => clock
	);
	try {
		recorder.read(0, 2);
		clock += 10000;
		recorder.setVisible(false);
		clock += 3600000;
		recorder.setVisible(true);
		recorder.read(0, 2);
		clock += 120000;
		await recorder.flush();
		await recorder.flush();
		expect(
			events
				.filter((e) => e.kind === 'study-time')
				.reduce((n, e) => n + Number(e.detail?.durationMs), 0)
		).toBe(70000);
		fail = true;
		await expect(recorder.finish()).rejects.toThrow();
		fail = false;
		expect(await recorder.finish()).toBe(1);
		await recorder.close();
		expect(events.filter((e) => e.kind === 'session-end')).toHaveLength(1);
	} finally {
		fail = false;
		await recorder.close();
	}
});
