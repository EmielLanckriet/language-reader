import { describe, it, expect, vi, beforeEach } from 'vitest';

// `base` is '' in these tests, so the runtime URLs are just the paths. Mocked rather than resolved
// because the value is irrelevant here and a fixed one makes the expected URLs readable.
vi.mock('$app/paths', () => ({ base: '' }));

import { downloadModel, modelIsStored } from '../../src/lib/analyzer/model-store';
import { RUNTIME_PATHS } from '../../src/lib/analyzer/model-cache';

/**
 * What a static host actually does to our own files, and what broke on the phone.
 *
 * GitHub Pages gzips `.js` and `.wasm`. `fetch` decompresses transparently, so the body is the
 * decoded bytes while `Content-Length` still describes the *compressed* transfer — measured on the
 * deployed site: ort-runtime.js is 24,218 bytes with `content-length: 9075`. Comparing the two
 * produced "downloaded incompletely (24218 of 9075 bytes)" on every attempt, and no amount of
 * pressing the button could ever have fixed it.
 *
 * The local verification server did not compress, which is exactly why this needs a test rather
 * than another laptop pass.
 */

interface Served {
	/** The bytes `fetch` hands back — already decompressed, as a browser would. */
	body: Uint8Array;
	/** What the host declares. For an encoded response this is the compressed size. */
	contentLength?: number;
	contentEncoding?: string;
	contentType?: string;
	/** End the stream early without erroring it: a genuinely short body, not a broken connection. */
	truncateTo?: number;
}

interface Entry {
	headers: Headers;
	bytes: Uint8Array;
}

/**
 * An in-memory stand-in for the Cache API.
 *
 * `put` consumes the response body the way the real one does, so a response whose stream errors
 * part-way rejects here too — which is what makes the truncation test meaningful.
 */
class FakeCache {
	entries = new Map<string, Entry>();

	async put(url: string, response: Response): Promise<void> {
		const buffer = await response.arrayBuffer();
		this.entries.set(url, { headers: response.headers, bytes: new Uint8Array(buffer) });
	}

	async match(url: string): Promise<Response | undefined> {
		const entry = this.entries.get(url);
		if (!entry) return undefined;
		const body = new ArrayBuffer(entry.bytes.byteLength);
		new Uint8Array(body).set(entry.bytes);
		return new Response(body, { headers: entry.headers });
	}

	async delete(url: string): Promise<boolean> {
		return this.entries.delete(url);
	}
}

let cache: FakeCache;

function install(responses: Record<string, Served>): void {
	cache = new FakeCache();
	vi.stubGlobal('caches', {
		open: async () => cache,
		delete: async () => {
			cache.entries.clear();
			return true;
		}
	});

	vi.stubGlobal('fetch', async (url: string) => {
		const served = responses[url];
		if (!served) return new Response(null, { status: 404 });

		const sent =
			served.truncateTo === undefined ? served.body : served.body.slice(0, served.truncateTo);
		const headers = new Headers();
		if (served.contentType) headers.set('content-type', served.contentType);
		if (served.contentLength !== undefined)
			headers.set('content-length', String(served.contentLength));
		if (served.contentEncoding) headers.set('content-encoding', served.contentEncoding);

		// A real stream, in more than one chunk, so progress is reported more than once.
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				for (let at = 0; at < sent.length; at += 1024) {
					controller.enqueue(sent.slice(at, at + 1024));
				}
				controller.close();
			}
		});
		return new Response(stream, { status: 200, headers });
	});
}

const MODEL_URL =
	'https://huggingface.co/Xenova/bert-base-chinese-ws/resolve/main/onnx/model_quantized.onnx';
const [RUNTIME_JS, RUNTIME_WASM] = RUNTIME_PATHS;

function bytes(count: number): Uint8Array {
	return new Uint8Array(count).fill(7);
}

/** The deployed shape: our own files gzipped, the model served uncompressed from HuggingFace. */
function asDeployed(): Record<string, Served> {
	return {
		[RUNTIME_JS]: {
			body: bytes(24218),
			contentLength: 9075,
			contentEncoding: 'gzip',
			contentType: 'application/javascript; charset=utf-8'
		},
		[RUNTIME_WASM]: {
			body: bytes(40000),
			contentLength: 12000,
			contentEncoding: 'gzip',
			contentType: 'application/wasm'
		},
		[MODEL_URL]: {
			body: bytes(60000),
			contentLength: 60000,
			contentType: 'application/octet-stream'
		}
	};
}

beforeEach(() => {
	vi.unstubAllGlobals();
});

describe('downloading the segmenter', () => {
	it('succeeds when the host gzips our own files', async () => {
		install(asDeployed());
		await expect(downloadModel()).resolves.toBeUndefined();
		await expect(modelIsStored()).resolves.toBe(true);
	});

	it('stores the decoded bytes, not a body mislabelled as still compressed', async () => {
		install(asDeployed());
		await downloadModel();

		// Keeping `content-encoding: gzip` on bytes that have already been decompressed is a second
		// way to break this: the service worker serves that response offline, and a client told the
		// body is gzip when it is not cannot load it. Same for a `content-length` describing the
		// compressed transfer.
		const stored = cache.entries.get(RUNTIME_JS);
		expect(stored?.bytes.byteLength).toBe(24218);
		expect(stored?.headers.get('content-encoding')).toBe(null);
		const declared = stored?.headers.get('content-length');
		expect(declared === null || Number(declared) === 24218).toBe(true);
		expect(stored?.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
	});

	it('still refuses a short body when the declared length can be trusted', async () => {
		// The protection worth keeping. The model is served uncompressed, so its `Content-Length`
		// describes the body: a truncated one would load and produce confident nonsense.
		const responses = asDeployed();
		responses[MODEL_URL].truncateTo = 40000;
		install(responses);

		await expect(downloadModel()).rejects.toThrow(/incompletely/);
		await expect(modelIsStored()).resolves.toBe(false);
	});

	it('never reports having received more than the total it claims', async () => {
		install(asDeployed());
		const seen: { receivedBytes: number; totalBytes?: number }[] = [];
		await downloadModel((p) => seen.push(p));

		expect(seen.length).toBeGreaterThan(1);
		for (const step of seen) {
			if (step.totalBytes !== undefined) {
				expect(step.receivedBytes).toBeLessThanOrEqual(step.totalBytes);
			}
		}
	});

	it('reports a total that is at least the bytes actually delivered', async () => {
		install(asDeployed());
		let last: { receivedBytes: number; totalBytes?: number } | undefined;
		await downloadModel((p) => (last = p));

		expect(last?.receivedBytes).toBe(24218 + 40000 + 60000);
		expect(last?.totalBytes).toBeGreaterThanOrEqual(last!.receivedBytes);
	});
});
