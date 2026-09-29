/**
 * The speech worker's messages (contracts/speech-worker.md), and a small client that the
 * transcriber and the calibration both use. The worker itself is created by the caller, with
 * `new Worker(new URL('./speech-worker.ts', import.meta.url), { type: 'module' })`, so Vite bundles
 * it; `SpeechPort` is what the client needs of it, which is also what a test fakes.
 */
import type { Token, WindowSettings } from './windows';

export type SpeechRequest =
	| { type: 'open'; base: string; revision: string; threads: number }
	| { type: 'transcribe'; job: string; settings: WindowSettings; from: number }
	| { type: 'stop' }
	| { type: 'time'; seconds: number; repeat: number };

export type SpeechReply =
	| { type: 'opened'; ms: number }
	| { type: 'planned'; job: string; duration: number; windows: number }
	| { type: 'window'; job: string; index: number; tokens: Token[]; ms: number }
	| { type: 'finished'; job: string }
	| { type: 'stopped'; job: string; next: number }
	| { type: 'timed'; ms: number }
	| { type: 'failed'; job?: string; reason: string };

export interface SpeechPort {
	postMessage(message: SpeechRequest): void;
	onmessage: ((event: MessageEvent<SpeechReply>) => void) | null;
	onerror?: ((event: ErrorEvent) => void) | null;
	terminate(): void;
}

export class SpeechClient {
	private listeners = new Set<(reply: SpeechReply) => void>();

	constructor(readonly port: SpeechPort) {
		port.onmessage = ({ data }) => {
			for (const listener of [...this.listeners]) listener(data);
		};
		port.onerror = (event) => {
			const reply: SpeechReply = {
				type: 'failed',
				reason: event.message || 'the speech worker stopped'
			};
			for (const listener of [...this.listeners]) listener(reply);
		};
	}

	/** Every reply, until the returned function is called. */
	listen(listener: (reply: SpeechReply) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	/** Send `request` and wait for the first reply `accept` takes, or a failure. */
	ask<R extends SpeechReply>(
		request: SpeechRequest,
		accept: (reply: SpeechReply) => reply is R
	): Promise<R> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.close();
			}, 90_000);
			const off = this.listen((reply) => {
				if (accept(reply)) {
					clearTimeout(timeout);
					off();
					resolve(reply);
				} else if (reply.type === 'failed' && !reply.job) {
					clearTimeout(timeout);
					off();
					reject(new Error(reply.reason));
				}
			});
			this.port.postMessage(request);
		});
	}

	async open(base: string, revision: string, threads: number): Promise<number> {
		return (
			await this.ask(
				{ type: 'open', base, revision, threads },
				(r): r is Extract<SpeechReply, { type: 'opened' }> => r.type === 'opened'
			)
		).ms;
	}

	async time(seconds: number, repeat: number): Promise<number> {
		return (
			await this.ask(
				{ type: 'time', seconds, repeat },
				(r): r is Extract<SpeechReply, { type: 'timed' }> => r.type === 'timed'
			)
		).ms;
	}

	close(): void {
		for (const listener of [...this.listeners])
			listener({ type: 'failed', reason: 'The speech worker was stopped.' });
		this.listeners.clear();
		this.port.terminate();
	}
}
