/**
 * Fetching and keeping the contextual segmentation model (ADR-0015).
 *
 * 98 MB, which is why it is not part of the install. The reader asks for it once; it is stored in
 * the Cache API and every later start finds it there, offline included. Until then the dictionary
 * segments, which is why asking for it is an improvement rather than a prerequisite.
 *
 * The Cache API rather than OPFS or IndexedDB, for one reason: the model is a static asset fetched
 * over HTTP, and the Cache API stores exactly that — a `Response`, with its headers, streamed
 * straight to disk without ever holding 98 MB in a JavaScript array. Slice 1 already established
 * that reader *data* lives in OPFS behind the storage worker; this is not reader data. It is
 * reference data that anyone could download again, and keeping the two in different places is the
 * point rather than an inconsistency.
 */

import { base } from '$app/paths';
import { BERT_MODEL } from './bert-vocab-version';
import { MODEL_CACHE, RUNTIME_PATHS } from './model-cache';

/** Where the model comes from. A public static file on a host we do not run and do not pay for. */
const MODEL_URL = `https://huggingface.co/${BERT_MODEL}/resolve/main/onnx/model_quantized.onnx`;

export interface DownloadProgress {
	receivedBytes: number;
	totalBytes?: number;
}

/** Every URL that has to be on the device for the model to run. */
function required(): string[] {
	return [MODEL_URL, ...RUNTIME_PATHS.map((path) => `${base}${path}`)];
}

/**
 * Whether this device can actually run the model.
 *
 * Asks about the runtime as well as the weights, on purpose. A device holding the model and not the
 * runtime cannot segment with it, and reporting otherwise would switch the analyzer to something
 * that then fails — so "stored" means *all* of it is stored.
 */
export async function modelIsStored(): Promise<boolean> {
	if (!('caches' in globalThis)) return false;
	try {
		const cache = await caches.open(MODEL_CACHE);
		const found = await Promise.all(required().map((url) => cache.match(url)));
		return found.every((response) => response !== undefined);
	} catch {
		// A browser that refuses cache access cannot hold the model, which is a reason to fall back
		// to the dictionary rather than to fail.
		return false;
	}
}

export async function storedModel(): Promise<ArrayBuffer | undefined> {
	if (!('caches' in globalThis)) return undefined;
	const cache = await caches.open(MODEL_CACHE);
	const response = await cache.match(MODEL_URL);
	return response ? await response.arrayBuffer() : undefined;
}

/**
 * Download everything the segmenter needs, reporting progress, and store it.
 *
 * The runtime is fetched alongside the weights rather than lazily on first use. Lazily was the
 * original design and it left a real hole: download on wi-fi, go offline, and the model is present
 * while the 14 MB runtime that executes it is not — so the reader has paid 74 MB and still reads
 * with the dictionary. Fetched together, they are either both there or neither is, which is also
 * what `modelIsStored` reports.
 *
 * Nothing is written to the cache until its whole response has arrived. A truncated model would
 * load and produce confident nonsense, which is worse than no model at all.
 */
export async function downloadModel(onProgress?: (p: DownloadProgress) => void): Promise<void> {
	const cache = await caches.open(MODEL_CACHE);

	// Runtime first: it is the smaller part, and finishing it means a failure part-way through the
	// large download leaves the cheap half already done for the retry.
	const order = [...RUNTIME_PATHS.map((path) => `${base}${path}`), MODEL_URL];

	let receivedBytes = 0;
	let knownTotal: number | undefined;

	for (const url of order) {
		const response = await fetch(url);
		if (!response.ok || !response.body) {
			throw new Error(`Could not download the segmenter (${response.status}).`);
		}

		const declared = Number(response.headers.get('content-length')) || undefined;
		// The total grows as each file declares its size. Honest rather than precise: it is better
		// to say "42 MB of 88 MB" once that is knowable than to invent a total up front.
		if (declared !== undefined) knownTotal = (knownTotal ?? receivedBytes) + declared;

		const reader = response.body.getReader();
		const chunks: BlobPart[] = [];
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			// Copied into its own buffer: a stream chunk may be a view over a shared buffer that
			// the reader is free to reuse, and Blob wants ownership of what it is given.
			chunks.push(new Uint8Array(value).slice().buffer as ArrayBuffer);
			receivedBytes += value.byteLength;
			onProgress?.({ receivedBytes, totalBytes: knownTotal });
		}

		const bytes = await new Blob(chunks).arrayBuffer();
		if (declared !== undefined && bytes.byteLength !== declared) {
			throw new Error(
				`The segmenter downloaded incompletely (${bytes.byteLength} of ${declared} bytes).`
			);
		}

		await cache.put(url, new Response(bytes, { headers: response.headers }));
	}
}

/** Frees the model and its runtime together, since neither is any use without the other. */
export async function discardModel(): Promise<void> {
	if (!('caches' in globalThis)) return;
	await caches.delete(MODEL_CACHE);
}
