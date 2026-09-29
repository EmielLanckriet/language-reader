import { describe, it, expect } from 'vitest';
import {
	Transcriber,
	METHOD,
	type TranscriberDeps,
	type Progress
} from '../../src/lib/speech/transcriber';
import {
	SpeechClient,
	type SpeechPort,
	type SpeechReply,
	type SpeechRequest
} from '../../src/lib/speech/worker-client';
import type { Token } from '../../src/lib/speech/windows';

/**
 * The one plumbing test the plan names (quickstart §1): a transcript interrupted and resumed is the
 * uninterrupted one. A fake worker answers each window with scripted tokens.
 */
const WINDOWS: Token[][] = [
	[
		['上', 0.2],
		['海', 0.5]
	],
	[
		['街', 9.5],
		['头', 12]
	],
	[
		['采', 40],
		['访', 41]
	],
	[
		['大', 70],
		['学', 71]
	]
];

/** Like the real worker: one window at a time, and `stop` is looked at before each. */
function fakeWorker(calls: SpeechRequest[] = []): SpeechPort {
	let stopping = false;
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
	const port: SpeechPort = {
		onmessage: null,
		terminate() {},
		postMessage(message) {
			calls.push(message);
			const send = (reply: SpeechReply) =>
				port.onmessage?.({ data: reply } as MessageEvent<SpeechReply>);
			if (message.type === 'open') queueMicrotask(() => send({ type: 'opened', ms: 1 }));
			if (message.type === 'stop') stopping = true;
			if (message.type === 'transcribe') {
				stopping = false;
				void (async () => {
					await tick();
					send({ type: 'planned', job: message.job, duration: 90, windows: WINDOWS.length });
					for (let i = message.from; i < WINDOWS.length; i++) {
						await tick();
						if (stopping) return send({ type: 'stopped', job: message.job, next: i });
						send({ type: 'window', job: message.job, index: i, tokens: WINDOWS[i], ms: 1 });
					}
					send({ type: 'finished', job: message.job });
				})();
			}
		}
	};
	return port;
}

function storage() {
	const saved = new Map<string, Progress>();
	const documents: string[] = [];
	const deps = (port: () => SpeechPort): TranscriberDeps => ({
		base: '',
		listPending: async () => (documents.length ? [] : ['job']),
		importedAt: async () => '2026-09-28T00:00:00Z',
		readProgress: async (job) => structuredClone(saved.get(job)),
		writeProgress: async (job, progress) => void saved.set(job, structuredClone(progress)),
		modelPresent: async () => true,
		threads: async () => 1,
		worker: () => new SpeechClient(port()),
		finish: async (_job, vtt) => {
			documents.push(vtt);
			return documents.length;
		},
		afterDocument: async () => {}
	});
	return { saved, documents, deps };
}

async function settled(t: Transcriber): Promise<void> {
	await t.idle();
}

describe('the transcriber', () => {
	it('gives the same transcript when stopped halfway and resumed as when run straight through', async () => {
		const straight = storage();
		const a = new Transcriber(straight.deps(() => fakeWorker()));
		a.wake();
		await settled(a);

		// Reader closed after two windows: whatever the worker still sends is never written.
		const interrupted = storage();
		const b = new Transcriber(interrupted.deps(() => fakeWorker()));
		b.subscribe((_job, state) => {
			if (state.kind === 'transcribing' && state.windowsDone === 2) b.shutdown();
		});
		b.wake();
		await settled(b);
		expect(interrupted.documents).toEqual([]);
		expect(interrupted.saved.get('job')!.windowsDone).toBe(2);

		// A new transcriber, as after Reader was closed and opened again, over what was saved.
		const calls: SpeechRequest[] = [];
		const c = new Transcriber(interrupted.deps(() => fakeWorker(calls)));
		c.wake();
		await settled(c);
		expect(calls.find((m) => m.type === 'transcribe')).toMatchObject({ from: 2 });
		expect(interrupted.documents).toEqual(straight.documents);
		expect(straight.documents[0]).toContain('上海');
	});

	it('waits once it is a lead ahead of playback, and carries on as playback catches up', async () => {
		const straight = storage();
		const a = new Transcriber(straight.deps(() => fakeWorker()));
		a.wake();
		await settled(a);

		const watched = storage();
		const t = new Transcriber(
			watched.deps(() => fakeWorker()),
			20
		);
		t.pace('job', 0);
		t.wake();
		// Through 41 s after the third window, 41 s ahead of playback: it stops there and waits.
		for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));
		expect(watched.saved.get('job')!.windowsDone).toBe(3);
		expect(watched.documents).toEqual([]);

		t.pace('job', 30);
		await settled(t);
		expect(watched.documents).toEqual(straight.documents);
	});

	it('starts again from the beginning when what was saved came from a different method', async () => {
		const s = storage();
		s.saved.set('job', {
			version: 1,
			method: { ...METHOD, revision: 'older' },
			duration: 90,
			windowsDone: 3,
			tokens: [['旧', 1]]
		});
		const calls: SpeechRequest[] = [];
		const t = new Transcriber(s.deps(() => fakeWorker(calls)));
		t.wake();
		await settled(t);
		expect(calls.find((m) => m.type === 'transcribe')).toMatchObject({ from: 0 });
		expect(s.documents[0]).not.toContain('旧');
	});
});
