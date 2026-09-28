/// <reference lib="webworker" />
/**
 * Transcription, off the main thread (contracts/speech-worker.md).
 *
 * One session per worker: onnxruntime-web fixes its thread count when it initialises, so another
 * thread count means another worker (research R2). The model and the video are read from OPFS here,
 * so no large buffer crosses the message boundary.
 */
import type * as Ort from 'onnxruntime-web';
import meta from './sense-voice-meta.json';
import { loadPending, isPlayable } from '$lib/media/store';
import { modelFiles } from './model';
import { SpeechAudio } from './audio';
import { parseTokens, transcribeWindow } from './pipeline';
import { keep } from './windows';
import type { SpeechReply, SpeechRequest } from './worker-client';

let ort: typeof Ort;
let session: Ort.InferenceSession;
let tokens: string[];
let stopping = false;

const reply = (message: SpeechReply) => self.postMessage(message);

async function open(base: string, revision: string, threads: number): Promise<number> {
	const started = performance.now();
	ort = await import('onnxruntime-web/wasm');
	ort.env.wasm.wasmPaths = {
		wasm: `${base}/ort/ort-runtime.wasm`,
		mjs: `${base}/ort/ort-runtime.js`
	};
	ort.env.wasm.numThreads = threads;
	const files = await modelFiles(revision);
	tokens = parseTokens(await files.tokens.text());
	session = await ort.InferenceSession.create(new Uint8Array(await files.model.arrayBuffer()), {
		executionProviders: ['wasm'],
		graphOptimizationLevel: 'all'
	});
	return performance.now() - started;
}

async function transcribe(data: Extract<SpeechRequest, { type: 'transcribe' }>): Promise<void> {
	const media = (await loadPending(data.job)).find((f) => isPlayable(f.name));
	if (!media) return reply({ type: 'failed', job: data.job, reason: 'the video is missing' });
	const audio = await SpeechAudio.open(media);
	if (typeof audio === 'string') return reply({ type: 'failed', job: data.job, reason: audio });
	try {
		for (let index = data.from; index < data.plan.length; index++) {
			if (stopping) return reply({ type: 'stopped', job: data.job, next: index });
			const w = data.plan[index];
			const started = performance.now();
			const samples = await audio.window(w.start, w.end);
			const found = await transcribeWindow(ort, session, tokens, meta, samples, w.start);
			reply({
				type: 'window',
				job: data.job,
				index,
				tokens: keep(data.plan, index, found),
				ms: performance.now() - started
			});
		}
		reply({ type: 'finished', job: data.job });
	} finally {
		audio.close();
	}
}

/** The encoder's cost depends on the audio's length, not on what is said (research R9). */
async function time(seconds: number, repeat: number): Promise<number> {
	const signal = Float32Array.from(
		{ length: seconds * 16000 },
		(_, i) => 0.1 * Math.sin(i / 7) * Math.sin(i / 1601)
	);
	let ms = 0;
	for (let r = 0; r < repeat; r++) {
		const started = performance.now();
		await transcribeWindow(ort, session, tokens, meta, signal, 0);
		ms = performance.now() - started;
	}
	return ms;
}

self.onmessage = async ({ data }: MessageEvent<SpeechRequest>) => {
	try {
		if (data.type === 'open')
			reply({ type: 'opened', ms: await open(data.base, data.revision, data.threads) });
		else if (data.type === 'transcribe') {
			stopping = false;
			await transcribe(data);
		} else if (data.type === 'stop') stopping = true;
		else if (data.type === 'time')
			reply({ type: 'timed', ms: await time(data.seconds, data.repeat) });
	} catch (error) {
		reply({
			type: 'failed',
			job: data.type === 'transcribe' ? data.job : undefined,
			reason: error instanceof Error ? error.message : String(error)
		});
	}
};
