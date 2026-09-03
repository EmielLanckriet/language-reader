/**
 * Running the contextual segmentation model in the browser (ADR-0015).
 *
 * All this file does is turn characters into a `Tagging` — the per-character B/I answers that
 * `tagger.ts` decodes into tokens. Everything that could corrupt an offset lives there, behind
 * property tests driven by fake taggers; everything here is glue that either works or throws.
 *
 * `onnxruntime-web` is imported dynamically, and its WebAssembly is served from `/ort/` rather than
 * precached, because 3.15 MB gzipped of runtime is useless without the 98 MB model and the reader
 * may never ask for either.
 */

import type { Analyzer } from './types';
import { taggedAnalyzer, type Tagging } from './tagger';
import { parseVocabulary, encodeCharacters } from './bert-tokenizer';
import { BERT_VOCAB_VERSION } from './bert-vocab-version';
import { storedModel } from './model-store';
import { base } from '$app/paths';

/**
 * Names the code, the vocabulary and the model together.
 *
 * All three decide the tokens, so all three belong in the version: a changed vocabulary with an
 * unchanged stamp would leave two segmentations sharing one version, which is what ADR-0011 exists
 * to prevent.
 */
export const BERT_ANALYZER_VERSION = `1-${BERT_VOCAB_VERSION}-q8`;

let session: Promise<import('onnxruntime-web').InferenceSession> | undefined;
let vocabulary: Promise<Map<string, number>> | undefined;

async function loadVocabulary(): Promise<Map<string, number>> {
	const response = await fetch(`${base}/bert-vocab-zh.txt`);
	if (!response.ok)
		throw new Error(`Could not load the segmenter vocabulary (${response.status}).`);
	return parseVocabulary(await response.text());
}

async function openSession() {
	const ort = await import('onnxruntime-web/wasm');

	// Named explicitly rather than by directory prefix. The runtime's own loader is a `.mjs` file,
	// and a host that serves .mjs as application/octet-stream makes it unloadable — browsers enforce
	// strict MIME checking on module scripts, and local verification hit exactly that. Served as
	// `.js`, which nothing gets wrong, and pointed at by name.
	ort.env.wasm.wasmPaths = {
		wasm: `${base}/ort/ort-runtime.wasm`,
		mjs: `${base}/ort/ort-runtime.js`
	};
	// One thread. The model runs on a phone, `crossOriginIsolated` is false without COOP/COEP
	// headers that a static host does not set, and threaded WASM silently falls back anyway.
	ort.env.wasm.numThreads = 1;

	const bytes = await storedModel();
	if (!bytes) throw new Error('The segmenter is not downloaded on this device.');

	return ort.InferenceSession.create(new Uint8Array(bytes), {
		executionProviders: ['wasm'],
		graphOptimizationLevel: 'all'
	});
}

const tagging: Tagging = async (characters) => {
	const ort = await import('onnxruntime-web/wasm');
	vocabulary ??= loadVocabulary();
	session ??= openSession();

	const [vocab, run] = await Promise.all([vocabulary, session]);
	const { inputIds, attentionMask, tokenTypeIds } = encodeCharacters(characters, vocab);
	const shape = [1, inputIds.length];

	const output = await run.run({
		input_ids: new ort.Tensor('int64', inputIds, shape),
		attention_mask: new ort.Tensor('int64', BigInt64Array.from(attentionMask), shape),
		token_type_ids: new ort.Tensor('int64', BigInt64Array.from(tokenTypeIds), shape)
	});

	const logits = output.logits.data as Float32Array;
	const labels: ('B' | 'I')[] = [];

	// Two labels per position: index 0 is B, index 1 is I. The first and last positions are the
	// model's own [CLS] and [SEP] markers and are skipped, so answer i belongs to character i.
	for (let i = 0; i < characters.length; i++) {
		const at = (i + 1) * 2;
		labels.push(logits[at] >= logits[at + 1] ? 'B' : 'I');
	}

	return labels;
};

export const bertAnalyzer: Analyzer = taggedAnalyzer(tagging, 'bert-ws-zh', BERT_ANALYZER_VERSION);

/** Forget the loaded session, so discarding the model does not leave it running from memory. */
export function releaseBertSession(): void {
	session = undefined;
}
