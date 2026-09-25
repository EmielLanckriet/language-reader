/// <reference lib="webworker" />
/**
 * The quick translator, off the main thread so a video keeps playing while it works (ADR-0023).
 * One line per request; the client decides the order.
 */

import { MODEL_CACHE } from '$lib/analyzer/model-cache';
import { parseVocabulary } from './unigram';
import { translateLine, type OpusModel } from './opus';
import type { QuickRequest, QuickReply } from './quick';

let model: Promise<OpusModel> | undefined;

async function stored(url: string): Promise<Response> {
	const response = await (await caches.open(MODEL_CACHE)).match(url);
	if (!response) throw new Error(`${url} is not downloaded.`);
	return response;
}

async function load(base: string, files: QuickRequest & { kind: 'open' }): Promise<OpusModel> {
	const ort = await import('onnxruntime-web/wasm');
	// The same runtime, and the same single thread, as the segmenter (bert-tagger.ts).
	ort.env.wasm.wasmPaths = {
		wasm: `${base}/ort/ort-runtime.wasm`,
		mjs: `${base}/ort/ort-runtime.js`
	};
	ort.env.wasm.numThreads = 1;
	const session = async (url: string) =>
		ort.InferenceSession.create(new Uint8Array(await (await stored(url)).arrayBuffer()), {
			executionProviders: ['wasm'],
			graphOptimizationLevel: 'all'
		});
	const [vocabulary, encoder, decoder] = await Promise.all([
		stored(files.tokenizer).then(async (r) => parseVocabulary(await r.json())),
		session(files.encoder),
		session(files.decoder)
	]);
	return { ort, vocabulary, encoder, decoder };
}

self.onmessage = async ({ data }: MessageEvent<QuickRequest>) => {
	const reply = (message: QuickReply) => self.postMessage(message);
	try {
		if (data.kind === 'open') {
			model = load(data.base, data);
			await model;
			reply({ kind: 'ready' });
		} else {
			if (!model) throw new Error('The quick translator was asked to translate before opening.');
			reply({
				kind: 'line',
				index: data.index,
				english: await translateLine(data.text, await model)
			});
		}
	} catch (error) {
		reply({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
	}
};
