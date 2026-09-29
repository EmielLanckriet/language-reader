/**
 * The transcriber as the app runs it: real storage, a real worker, real documents. Started once
 * from the root layout, like the backup timer, so it works on every page (FR-015).
 */
import { inferenceBudget } from '$lib/inference-budget';
import { base } from '$app/paths';
import { createMediaDocument, titleIn } from '$lib/media/import';
import {
	listPending,
	loadPending,
	readPending,
	removePending,
	writeMediaJson,
	writePending,
	PENDING_INFO,
	TRANSCRIPT,
	TRANSCRIPT_METHOD
} from '$lib/media/store';
import { modelState, TOTAL_BYTES } from './model';
import { downloadModel, ModelDownloadError } from './model-download';
import { sendTranscript, sendUnsent } from './send';
import { Transcriber, type Progress } from './transcriber';
import { SpeechClient } from './worker-client';

const RETRY_MS = 5 * 60 * 1000;
/** Files beside a pending video that are the transcriber's own, not the video's. */
const OWN = new Set([PENDING_INFO, TRANSCRIPT, `${PENDING_INFO}.part`, `${TRANSCRIPT}.part`]);

let workerRequest = new AbortController();
const newWorker = async () => {
	const release = await inferenceBudget(workerRequest.signal);
	try {
		const client = new SpeechClient(
			new Worker(new URL('./speech-worker.ts', import.meta.url), { type: 'module' })
		);
		const close = client.close.bind(client);
		client.close = () => {
			close();
			release();
		};
		return client;
	} catch (error) {
		release();
		throw error;
	}
};

export type SetupState =
	| { kind: 'checking' }
	| { kind: 'missing' }
	| { kind: 'downloading'; bytes: number; total: number }
	| { kind: 'paused'; bytes: number; total: number; message?: string }
	| { kind: 'calibrating'; step: number; of: number }
	| { kind: 'ready' }
	| { kind: 'failed'; message: string };

/**
 * The one-time setup (spec story 2): the reader agrees to the download, which then resumes by itself
 * whenever it was interrupted. Runtime calibration is disabled after the phone freeze incident.
 */
class SpeechSetup {
	state: SetupState = { kind: 'checking' };
	private readonly listeners = new Set<(state: SetupState) => void>();
	private busy: Promise<void> | undefined;

	subscribe(listener: (state: SetupState) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	private set(state: SetupState): void {
		this.state = state;
		for (const listener of [...this.listeners]) listener(state);
	}

	/** Where things stand; resumes a download the reader already agreed to. */
	async refresh(): Promise<void> {
		const model = await modelState();
		if (model.kind === 'present') return this.ready();
		if (model.kind === 'partial') {
			this.set({ kind: 'paused', bytes: model.bytes, total: TOTAL_BYTES });
			if (navigator.onLine) return this.download();
			return;
		}
		this.set({ kind: 'missing' });
	}

	/** The reader agreed, or a download they agreed to earlier can continue. */
	download(): Promise<void> {
		this.busy ??= (async () => {
			try {
				await downloadModel((bytes, total) => this.set({ kind: 'downloading', bytes, total }));
				await this.ready();
			} catch (error) {
				const model = await modelState();
				const message =
					error instanceof ModelDownloadError ? error.message : 'The download stopped.';
				if (model.kind === 'partial')
					this.set({ kind: 'paused', bytes: model.bytes, total: TOTAL_BYTES, message });
				else this.set({ kind: 'failed', message });
			} finally {
				this.busy = undefined;
			}
		})();
		return this.busy;
	}

	private async ready(): Promise<void> {
		this.set({ kind: 'ready' });
		transcriber.wake();
	}
}

export const speechSetup = new SpeechSetup();

export const transcriber = new Transcriber({
	base,
	listPending,
	importedAt: async (job) =>
		(await readPending<{ importedAt?: string }>(job, PENDING_INFO))?.importedAt,
	readProgress: (job) => readPending<Progress>(job, TRANSCRIPT),
	writeProgress: (job, progress) => writePending(job, TRANSCRIPT, progress),
	// Wait until the complete model is on disk.
	modelPresent: async () => speechSetup.state.kind === 'ready',
	// No automatic multi-core benchmark on a phone recovering from resource exhaustion.
	threads: async () => 1,
	worker: newWorker,
	async finish(job, vtt, method) {
		const files = (await loadPending(job)).filter((file) => !OWN.has(file.name));
		const meta = files.find((file) => file.name === 'meta.json');
		const title = meta ? titleIn(await meta.text(), 'Video') : 'Video';
		const id = await createMediaDocument(title, vtt, [
			...files.map((file) => ({ name: file.name, blob: file as Blob })),
			{ name: 'media.zh.vtt', blob: new Blob([vtt], { type: 'text/vtt' }) }
		]);
		await writeMediaJson(id, TRANSCRIPT_METHOD, method);
		await removePending(job);
		return id;
	},
	afterDocument: async (id) => void (await sendTranscript(id).catch(() => false))
});

let started = false;

/** At app start: resume pending transcripts, and send the ones Termux has not got. */
export function startTranscriber(): () => void {
	if (started) return () => {};
	started = true;
	if (document.visibilityState !== 'visible') workerRequest.abort();
	else if (workerRequest.signal.aborted) workerRequest = new AbortController();
	transcriber.setActive(document.visibilityState === 'visible');
	void speechSetup.refresh().then(() => transcriber.wake());
	void sendUnsent();
	const timer = setInterval(() => void sendUnsent(), RETRY_MS);
	const online = () => {
		if (speechSetup.state.kind === 'paused') void speechSetup.download();
	};
	addEventListener('online', online);
	const visible = () => {
		if (document.visibilityState !== 'visible') workerRequest.abort();
		else if (workerRequest.signal.aborted) workerRequest = new AbortController();
		transcriber.setActive(document.visibilityState === 'visible');
	};
	document.addEventListener('visibilitychange', visible);
	const hide = () => {
		workerRequest.abort();
		transcriber.setActive(false);
	};
	addEventListener('pagehide', hide);
	addEventListener('pageshow', visible);
	return () => {
		workerRequest.abort();
		transcriber.setActive(false);
		started = false;
		clearInterval(timer);
		removeEventListener('online', online);
		document.removeEventListener('visibilitychange', visible);
		removeEventListener('pagehide', hide);
		removeEventListener('pageshow', visible);
	};
}
