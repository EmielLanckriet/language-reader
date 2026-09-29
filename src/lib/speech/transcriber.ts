/**
 * The app-wide transcriber (research R7, data-model.md): whenever Reader is open, pending videos
 * are transcribed one at a time, the one being watched first, saved after every window so that an
 * interrupted transcript continues where it stopped, and turned into documents when complete.
 *
 * Its storage, worker and document creation are passed in, so the one plumbing test can drive it
 * with fakes (tests/speech/transcriber.test.ts); `startTranscriber` wires in the real ones.
 */
import { REVISION, RUNTIME } from './model';
import { lines, toVtt } from './lines';
import { WINDOWS, type Token, type WindowSettings } from './windows';
import type { SpeechClient, SpeechReply } from './worker-client';

/** What produces a transcript (FR-012). A saved transcript resumes only under the same method. */
export const METHOD = {
	model: 'sense-voice-small-int8',
	revision: REVISION,
	runtime: RUNTIME,
	window: WINDOWS as WindowSettings,
	itn: false,
	resampler: 'kaiser-sinc-0.97'
};
export type Method = typeof METHOD;

export interface Progress {
	version: 1;
	method: Method;
	duration?: number;
	windowsDone: number;
	tokens: Token[];
}

export type JobState =
	| { kind: 'waiting-for-model' }
	| { kind: 'queued'; behind: string }
	| { kind: 'loading' }
	| { kind: 'transcribing'; windowsDone: number; windows: number; through: number; total: number }
	| { kind: 'finishing' }
	| { kind: 'done'; documentId: number }
	| { kind: 'failed'; reason: string };

export interface TranscriberDeps {
	/** The application's base path, where the runtime is served (`/ort/`). */
	base: string;
	listPending(): Promise<string[]>;
	importedAt(job: string): Promise<string | undefined>;
	readProgress(job: string): Promise<Progress | undefined>;
	writeProgress(job: string, progress: Progress): Promise<void>;
	modelPresent(): Promise<boolean>;
	threads(): Promise<number>;
	worker(): SpeechClient;
	/** Make the document from the finished transcript, and remove the pending video. */
	finish(job: string, vtt: string, method: Method): Promise<number>;
	/** After a document exists: hand the transcript on for translation (FR-019). */
	afterDocument(documentId: number): Promise<void>;
}

/**
 * While the reader watches, the transcript keeps this far ahead of playback and waits there (s).
 * Measured on the phone: with the video playing, windows took 33 s instead of 22 s and the video
 * ran at 0.75x, since the decoder, the video and quick English share two fast cores. A lead leaves
 * them the cores; the rest is transcribed when playback pauses or the reader leaves.
 */
export const LEAD = 60;

type Listener = (job: string, state: JobState, tokens: Token[]) => void;

const same = (a: Method, b: Method) => JSON.stringify(a) === JSON.stringify(b);

export class Transcriber {
	private readonly states = new Map<string, JobState>();
	private readonly tokens = new Map<string, Token[]>();
	private readonly listeners = new Set<Listener>();
	private readonly failed = new Set<string>();
	/** Jobs whose worker already failed once this session: a second failure is final. */
	private readonly retried = new Set<string>();
	private preferred: string | undefined;
	private client: SpeechClient | undefined;
	private running: Promise<void> | undefined;
	private again = false;
	private closed = false;
	private current: string | undefined;
	private watching: { job: string; at: number } | undefined;
	private resume: (() => void) | undefined;
	/** Ends the window loop in progress: closing the worker drops its listeners, and so its end. */
	private abandon: (() => void) | undefined;

	constructor(
		private readonly deps: TranscriberDeps,
		private readonly lead = LEAD
	) {}

	/** Where playback is in the video being watched; `undefined` once it pauses or the page goes. */
	pace(job: string, at: number | undefined): void {
		this.watching = at === undefined ? undefined : { job, at };
		if (this.ahead(job)) {
			if (this.current === job) this.client?.port.postMessage({ type: 'stop' });
		} else this.resume?.();
	}

	private ahead(job: string): boolean {
		const watching = this.watching;
		if (!watching || watching.job !== job) return false;
		return (this.tokens.get(job)?.at(-1)?.[1] ?? 0) - watching.at >= this.lead;
	}

	/** Until the watched video's lead runs short, or it stops being watched. */
	private paced(job: string): Promise<void> {
		if (!this.ahead(job)) return Promise.resolve();
		return new Promise((resolve) => {
			this.resume = () => {
				this.resume = undefined;
				resolve();
			};
		});
	}

	/** Every change of every job's state, starting with the current ones. */
	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		for (const [job, state] of this.states) listener(job, state, this.tokens.get(job) ?? []);
		return () => this.listeners.delete(listener);
	}

	state(job: string): JobState | undefined {
		return this.states.get(job);
	}

	/**
	 * Look for work: at start, after an import, after the model arrives. `retry` also tries the jobs
	 * that failed, as on returning to the page: a transcript that finished while the page was hidden
	 * could not create its document then (the storage lease goes with the page), and completes now.
	 */
	wake({ retry = false } = {}): void {
		if (this.closed) return;
		if (retry) this.failed.clear();
		if (this.running) {
			this.again = true;
			return;
		}
		this.running = this.run().finally(() => {
			this.running = undefined;
			if (this.again) {
				this.again = false;
				this.wake();
			}
		});
	}

	/** The video being watched goes first; another in progress yields at its next window. */
	prefer(job: string): void {
		this.preferred = job;
		this.failed.delete(job);
		if (this.current && this.current !== job) this.client?.port.postMessage({ type: 'stop' });
		this.wake();
	}

	/** Resolves when there is nothing left to do for now. */
	async idle(): Promise<void> {
		while (this.running) await this.running;
	}

	/** Stop at once, writing nothing more: what happens to the work when Reader is closed. */
	shutdown(): void {
		this.closed = true;
		this.resume?.();
		this.abandon?.();
		this.client?.close();
		this.client = undefined;
	}

	private publish(job: string, state: JobState): void {
		this.states.set(job, state);
		const tokens = this.tokens.get(job) ?? [];
		for (const listener of [...this.listeners]) listener(job, state, tokens);
	}

	private async run(): Promise<void> {
		for (;;) {
			if (this.closed) return;
			const jobs = (await this.deps.listPending()).filter((job) => !this.failed.has(job));
			if (jobs.length === 0) return this.release();
			if (!(await this.deps.modelPresent())) {
				for (const job of jobs) this.publish(job, { kind: 'waiting-for-model' });
				return this.release();
			}
			const job = await this.pick(jobs);
			for (const other of jobs)
				if (other !== job) this.publish(other, { kind: 'queued', behind: job });
			await this.paced(job);
			if (this.closed) return;
			await this.transcribe(job);
		}
	}

	private async pick(jobs: string[]): Promise<string> {
		if (this.preferred && jobs.includes(this.preferred)) return this.preferred;
		const dated = await Promise.all(
			jobs.map(async (job) => [job, (await this.deps.importedAt(job)) ?? ''] as const)
		);
		return dated.sort((a, b) => a[1].localeCompare(b[1]))[0][0];
	}

	/** No work left: free the model's memory. */
	private release(): void {
		this.client?.close();
		this.client = undefined;
	}

	private async transcribe(job: string): Promise<void> {
		const saved = await this.deps.readProgress(job);
		const progress: Progress =
			saved && saved.version === 1 && same(saved.method, METHOD)
				? saved
				: { version: 1, method: METHOD, windowsDone: 0, tokens: [] };
		this.tokens.set(job, progress.tokens);
		this.current = job;
		try {
			if (!this.client) {
				this.publish(job, { kind: 'loading' });
				this.client = this.deps.worker();
				await this.client.open(this.deps.base, REVISION, await this.deps.threads());
			}
			const outcome = await this.windows(job, progress);
			if (outcome === 'finished' && !this.closed) await this.complete(job, progress);
		} catch (error) {
			if (this.closed) return;
			// A worker that died mid-window (out of memory, a crash) is replaced once; the job resumes
			// from its saved windows. The same failure again is the job's, not the worker's.
			this.release();
			if (!this.retried.has(job)) {
				this.retried.add(job);
				return;
			}
			this.failed.add(job);
			this.publish(job, {
				kind: 'failed',
				reason: error instanceof Error ? error.message : String(error)
			});
		} finally {
			this.current = undefined;
		}
	}

	/** Run the job's remaining windows, saving after each; resolves with how the run ended. */
	private windows(job: string, progress: Progress): Promise<'finished' | 'stopped'> {
		const client = this.client!;
		return new Promise((resolve, reject) => {
			let windows = 0;
			let ended = false;
			// One reply at a time, in order: each window is saved before the next is looked at.
			let chain = Promise.resolve();
			this.abandon = () => {
				ended = true;
				off();
				resolve('stopped');
			};
			const off = client.listen((reply: SpeechReply) => {
				chain = chain
					.then(async () => {
						if (ended) return;
						if (this.closed) {
							off();
							return resolve('stopped');
						}
						if (reply.type === 'failed') throw new Error(reply.reason);
						if (!('job' in reply) || reply.job !== job) return;
						if (reply.type === 'planned') {
							progress.duration = reply.duration;
							windows = reply.windows;
							this.publish(job, this.transcribing(progress, windows));
						} else if (reply.type === 'window') {
							progress.tokens.push(...reply.tokens);
							progress.windowsDone = reply.index + 1;
							await this.deps.writeProgress(job, progress);
							if (this.closed) {
								off();
								return resolve('stopped');
							}
							this.publish(job, this.transcribing(progress, windows));
							if (this.ahead(job)) client.port.postMessage({ type: 'stop' });
						} else if (reply.type === 'finished' || reply.type === 'stopped') {
							ended = true;
							off();
							resolve(reply.type);
						}
					})
					.catch((error: unknown) => {
						// Reject the window loop too: a rejected save otherwise leaves it waiting forever.
						// Replies already queued from this worker must not write after the retry starts.
						ended = true;
						off();
						reject(error);
					});
			});
			client.port.postMessage({
				type: 'transcribe',
				job,
				settings: METHOD.window,
				from: progress.windowsDone
			});
		});
	}

	private transcribing(progress: Progress, windows: number): JobState {
		const through = progress.tokens.at(-1)?.[1] ?? 0;
		return {
			kind: 'transcribing',
			windowsDone: progress.windowsDone,
			windows,
			through,
			total: progress.duration ?? 0
		};
	}

	private async complete(job: string, progress: Progress): Promise<void> {
		this.publish(job, { kind: 'finishing' });
		const vtt = toVtt(lines(progress.tokens));
		if (!progress.tokens.length) throw new Error('No speech was found in this video.');
		const documentId = await this.deps.finish(job, vtt, METHOD);
		if (this.preferred === job) this.preferred = undefined;
		this.publish(job, { kind: 'done', documentId });
		await this.deps.afterDocument(documentId).catch(() => {});
	}
}
