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
 * How many bytes the body should turn out to be, or undefined when nothing here can say.
 *
 * `Content-Length` describes the *transfer*, not the body. Where the host compressed the response,
 * `fetch` hands back the decompressed bytes while the header still counts the compressed ones, and
 * comparing the two is not a completeness check — it is a guaranteed mismatch. Measured on the
 * deployed site: ort-runtime.js arrives as 24,218 bytes under `content-length: 9075`, and the
 * earlier version of this function rejected it as "incomplete" on every single attempt.
 *
 * The check is kept where it still means something, which is where it matters most: HuggingFace
 * serves the 98 MB model uncompressed, so its declared length really is the body's length, and a
 * truncated model would load and produce confident nonsense. For a compressed response the
 * guarantee comes from the stream instead — a body cut short by a dropped connection errors it,
 * and an errored stream fails the `cache.put` below rather than storing half a file.
 *
 * The local verification server did not compress, which is why a laptop pass could never have
 * found this and tests/analyzer/model-store.test.ts now describes the host's actual behaviour.
 */
function expectedBodyBytes(response: Response): number | undefined {
	if (response.headers.get('content-encoding')) return undefined;
	const declared = Number(response.headers.get('content-length'));
	return Number.isFinite(declared) && declared > 0 ? declared : undefined;
}

/**
 * The headers to keep on the stored copy: the content type, and deliberately nothing else.
 *
 * Passing the response's own headers through was a second bug hiding behind the first. It copies
 * `content-encoding: gzip` onto bytes that have already been decompressed, and a `content-length`
 * describing the compressed transfer — so the service worker would later serve a runtime that
 * claims to be gzip and is not. The content type is the one header that is still true of what we
 * are storing, and it is the one that matters: a `.js` served as octet-stream is unloadable as a
 * module, which this project has already been bitten by once.
 */
function storedHeaders(response: Response): Headers {
	const headers = new Headers();
	const type = response.headers.get('content-type');
	if (type) headers.set('content-type', type);
	return headers;
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
 * Streamed into the cache rather than buffered and then written. Buffering meant holding the whole
 * 98 MB model in a chunk array and copying it again through a Blob — some 200 MB at peak, on a
 * phone, which is a plausible way to fail a download that has otherwise succeeded. Nothing here
 * holds more than one chunk at a time.
 *
 * The cost of streaming is that a short file is stored before it can be measured, so it is deleted
 * again on the spot. Between the two, `modelIsStored` never sees it: the throw happens before the
 * next file is fetched, and it asks for all three.
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

		const expected = expectedBodyBytes(response);
		// The total grows as each file declares a size that can be believed. Honest rather than
		// precise: it is better to say "42 MB of 88 MB" once that is knowable than to invent a
		// total up front, and better to say "42 MB so far" than to quote one that is wrong.
		if (expected !== undefined) knownTotal = (knownTotal ?? receivedBytes) + expected;

		let bodyBytes = 0;
		const counted = response.body.pipeThrough(
			new TransformStream<Uint8Array, Uint8Array>({
				transform(chunk, controller) {
					bodyBytes += chunk.byteLength;
					receivedBytes += chunk.byteLength;
					onProgress?.({ receivedBytes, totalBytes: knownTotal });
					controller.enqueue(chunk);
				}
			})
		);

		await cache.put(url, new Response(counted, { headers: storedHeaders(response) }));

		if (expected !== undefined && bodyBytes !== expected) {
			await cache.delete(url);
			throw new Error(`The segmenter downloaded incompletely (${bodyBytes} of ${expected} bytes).`);
		}
	}
}

/** Frees the model and its runtime together, since neither is any use without the other. */
export async function discardModel(): Promise<void> {
	if (!('caches' in globalThis)) return;
	await caches.delete(MODEL_CACHE);
}
