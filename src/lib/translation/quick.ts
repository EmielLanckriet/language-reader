/**
 * Quick English for every line, within seconds of opening (ADR-0023, Principle VIII).
 *
 * opus-mt-zh-en runs in a worker on the runtime the segmenter already uses. The model (~115 MB) is
 * fetched once, into the same cache as that runtime, the first time a video is opened. Lines are
 * translated nearest-first from wherever the reader is, and whichever line they ask about jumps
 * the queue.
 */

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
 * `finished` says no more lines will come; until then the model stays loaded between lines.
 */
export function quickTranslation(
	linesNow: () => readonly string[],
	have: (index: number) => boolean,
	onLine: (index: number, english: string) => void,
	onStatus: (status: string | undefined) => void,
	finished: () => boolean = () => true
): QuickTranslation {
	let stopped = false;
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
		if (stopped || busy || !worker) return;
		const index = next();
		if (index === undefined) {
			if (!finished()) return;
			// Every line has English. Unloading frees ~0.6 GB, which is what lets Termux's LLM start
			// its upgrade: translate.py waits for that much memory (ADR-0023).
			worker.terminate();
			worker = undefined;
			return;
		}
		busy = true;
		const text = linesNow()[index];
		worker.postMessage({ kind: 'translate', index, text } satisfies QuickRequest);
	}

	async function begin() {
		try {
			if (!('caches' in globalThis)) return;
			// After an await, not before: begin() starts inside the page's effect, and reading the
			// page's lines synchronously there made the effect re-run and restart this, 1001 times
			// in one load, measured.
			await Promise.resolve();
			// Nothing left to translate (a video reopened after its quick pass): no model, no memory.
			if (next() === undefined && finished()) return;
			onStatus('Quick English: getting ready…');
			await ensureDownloaded((mb) => onStatus(`Quick English: downloading, ${mb} of ~120 MB…`));
			if (stopped) return;
			worker = new Worker(new URL('./quick-worker.ts', import.meta.url), { type: 'module' });
			worker.onmessage = ({ data }: MessageEvent<QuickReply>) => {
				if (data.kind === 'ready') onStatus(undefined);
				else if (data.kind === 'line') {
					busy = false;
					if (asked === data.index) asked = undefined;
					onLine(data.index, data.english);
				} else {
					busy = false;
					onStatus(`Quick English is unavailable: ${data.message}`);
					return;
				}
				pump();
			};
			worker.postMessage({ kind: 'open', base, ...FILES } satisfies QuickRequest);
		} catch (error) {
			onStatus(`Quick English is unavailable: ${error instanceof Error ? error.message : error}`);
		}
	}

	void begin();
	return {
		focus(index, urgent = false) {
			front = index;
			if (urgent) asked = index;
			pump();
		},
		more: () => pump(),
		stop() {
			stopped = true;
			worker?.terminate();
		}
	};
}
