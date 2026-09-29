/**
 * Quick English for every line, within seconds of opening (ADR-0023, Principle VIII).
 *
 * opus-mt-zh-en runs in a worker on the runtime the segmenter already uses. The model (~115 MB) is
 * fetched once, into the same cache as that runtime, the first time a video is opened. Lines are
 * translated nearest-first from wherever the reader is, and whichever line they ask about jumps
 * the queue.
 */

import { inferenceBudget } from '$lib/inference-budget';
import { base } from '$app/paths';
import { MODEL_CACHE, RUNTIME_PATHS } from '$lib/analyzer/model-cache';
import { downloadInto } from '$lib/analyzer/model-store';

const MODEL = 'https://huggingface.co/Xenova/opus-mt-zh-en/resolve/main';
const FILES = {
	tokenizer: `${MODEL}/tokenizer.json`,
	encoder: `${MODEL}/onnx/encoder_model_quantized.onnx`,
	decoder: `${MODEL}/onnx/decoder_model_merged_quantized.onnx`
};

export type QuickRequest =
	| ({ kind: 'open'; base: string } & typeof FILES)
	| { kind: 'translate'; index: number; text: string };

export type QuickReply =
	| { kind: 'ready' }
	| { kind: 'line'; index: number; english: string }
	| { kind: 'failed'; message: string };

/** Whether the model and runtime are all on the device: the library translates titles only then. */
export async function quickTranslatorPresent(): Promise<boolean> {
	if (!('caches' in globalThis)) return false;
	const cache = await caches.open(MODEL_CACHE);
	const wanted = [...RUNTIME_PATHS.map((path) => `${base}${path}`), ...Object.values(FILES)];
	for (const url of wanted) if (!(await cache.match(url))) return false;
	return true;
}

/** Fetches whatever of the model and runtime is not on the device yet, streamed into the cache. */
async function ensureDownloaded(onProgress: (megabytes: number) => void): Promise<void> {
	const cache = await caches.open(MODEL_CACHE);
	const wanted = [...RUNTIME_PATHS.map((path) => `${base}${path}`), ...Object.values(FILES)];
	const missing: string[] = [];
	for (const url of wanted) if (!(await cache.match(url))) missing.push(url);
	if (missing.length === 0) return;
	await downloadInto(missing, 'the quick translator', (p) =>
		onProgress(Math.round(p.receivedBytes / 1e6))
	);
}

/** What to tell the reader, as a bar when there is something to measure. */
export interface QuickStatus {
	label: string;
	fraction?: number;
}

/** The runtime (13 MB), tokenizer (6 MB), encoder (53 MB) and decoder (60 MB), measured. */
const DOWNLOAD_MB = 133;

export interface QuickTranslation {
	/** Move the queue's front to this line: where playback is, or a line the reader asked about. */
	focus(index: number, urgent?: boolean): void;
	/** New lines have arrived (a transcript still being written). */
	more(): void;
	stop(): void;
}

/**
 * Translates the lines `linesNow` returns, except those `have` already covers, calling `onLine` as
 * each arrives and `onStatus` with what to tell the reader (undefined once it is simply working).
 * The model is unloaded whenever no untranslated lines remain; `more` starts it again.
 */
export function quickTranslation(
	linesNow: () => readonly string[],
	have: (index: number) => boolean,
	onLine: (index: number, english: string) => void,
	onStatus: (status: QuickStatus | undefined) => void
): QuickTranslation {
	let stopped = false;
	let generation = 0;
	let starting = false;
	let request = new AbortController();
	let release: (() => void) | undefined;
	let deadline: ReturnType<typeof setTimeout> | undefined;
	const visible = () => document.visibilityState === 'visible';
	function unload() {
		worker?.terminate();
		worker = undefined;
		clearTimeout(deadline);
		release?.();
		release = undefined;
		busy = false;
	}
	let worker: Worker | undefined;
	let busy = false;
	let front = 0;
	let asked: number | undefined;

	function next(): number | undefined {
		const lines = linesNow();
		if (asked !== undefined && asked < lines.length && !have(asked)) return asked;
		for (let offset = 0; offset < lines.length; offset++) {
			const index = (front + offset) % lines.length;
			if (!have(index) && lines[index].trim()) return index;
		}
		return undefined;
	}

	function pump() {
		if (stopped || !visible() || busy || !worker) return;
		const index = next();
		if (index === undefined) {
			// Every line has English. Unloading frees ~0.6 GB, which is what lets Termux's LLM start
			// its upgrade: translate.py waits for that much memory (ADR-0023).
			unload();
			return;
		}
		busy = true;
		const text = linesNow()[index];
		armDeadline();
		worker.postMessage({ kind: 'translate', index, text } satisfies QuickRequest);
	}

	function armDeadline() {
		clearTimeout(deadline);
		deadline = setTimeout(() => {
			unload();
			onStatus({
				label: 'Quick English stopped because processing took too long. Reopen to retry.'
			});
		}, 90_000);
	}

	async function begin() {
		if (stopped || !visible() || starting || worker) return;
		starting = true;
		const version = generation;
		const signal = request.signal;
		try {
			if (!('caches' in globalThis)) return;
			// After an await, not before: begin() starts inside the page's effect, and reading the
			// page's lines synchronously there made the effect re-run and restart this, 1001 times
			// in one load, measured.
			await Promise.resolve();
			// Nothing left to translate (a video reopened after its quick pass): no model, no memory.
			if (next() === undefined) return;
			onStatus({ label: 'Getting English ready…' });
			await ensureDownloaded((mb) =>
				onStatus({
					label: `Downloading the translator, once: ${mb} of ${DOWNLOAD_MB} MB`,
					fraction: mb / DOWNLOAD_MB
				})
			);
			onStatus({ label: 'Getting English ready…' });
			if (stopped || signal.aborted) return;
			const unlock = await inferenceBudget(signal);
			if (stopped || signal.aborted) {
				unlock();
				return;
			}
			release = unlock;
			armDeadline();
			worker = new Worker(new URL('./quick-worker.ts', import.meta.url), { type: 'module' });
			worker.onmessage = ({ data }: MessageEvent<QuickReply>) => {
				clearTimeout(deadline);
				if (data.kind === 'ready') onStatus(undefined);
				else if (data.kind === 'line') {
					busy = false;
					if (asked === data.index) asked = undefined;
					onLine(data.index, data.english);
				} else {
					unload();
					onStatus({ label: `Quick English is unavailable: ${data.message}` });
					return;
				}
				pump();
			};
			worker.onerror = () => {
				unload();
				onStatus({ label: 'Quick English stopped unexpectedly. Reopen to retry.' });
			};
			worker.postMessage({ kind: 'open', base, ...FILES } satisfies QuickRequest);
		} catch (error) {
			if (signal.aborted) return;
			unload();
			onStatus({
				label: `Quick English is unavailable: ${error instanceof Error ? error.message : error}`
			});
		} finally {
			if (version === generation) starting = false;
		}
	}

	function suspend() {
		generation++;
		request.abort();
		starting = false;
		unload();
	}
	function visibility() {
		if (!visible()) suspend();
		else {
			if (request.signal.aborted) request = new AbortController();
			void begin();
		}
	}
	document.addEventListener('visibilitychange', visibility);
	addEventListener('pagehide', suspend);
	addEventListener('pageshow', visibility);
	void begin();
	return {
		focus(index, urgent = false) {
			front = index;
			if (urgent) asked = index;
			if (worker) pump();
			else void begin();
		},
		more: () => {
			if (worker) pump();
			else void begin();
		},
		stop() {
			stopped = true;
			suspend();
			document.removeEventListener('visibilitychange', visibility);
			removeEventListener('pagehide', suspend);
			removeEventListener('pageshow', visibility);
		}
	};
}
