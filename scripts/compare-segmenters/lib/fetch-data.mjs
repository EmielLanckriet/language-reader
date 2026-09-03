// Fetching a candidate's reference data at run time, and caching it locally so repeat runs of the
// harness do not re-download megabytes of dictionary every time.
//
// The cache directory is `scripts/compare-segmenters/data/`, which `.gitignore` already excludes
// (ADR-0012: dictionaries are megabytes and must never be committed or bundled). Nothing here ships
// with the application; this file is only ever invoked from this directory's own scripts.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = join(HERE, '..', 'data');

/**
 * Fetch `url` into `data/<cacheFileName>`, returning its contents as a UTF-8 string. If a cached
 * copy already exists, the network is not touched at all.
 *
 * If `gunzip` is true, the downloaded bytes are decompressed before being cached, so the cache
 * always holds plain text and every caller downstream is spared from knowing which candidates
 * happen to be gzipped upstream.
 *
 * Throws with a message naming the URL and the underlying cause on any failure — the caller is
 * expected to catch this and skip the candidate rather than let one dead network connection take
 * down the whole comparison run.
 */
export async function fetchCached(url, cacheFileName, { gunzip = false } = {}) {
	mkdirSync(DATA_DIR, { recursive: true });
	const cachePath = join(DATA_DIR, cacheFileName);

	if (existsSync(cachePath)) {
		return readFileSync(cachePath, 'utf-8');
	}

	let response;
	try {
		response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
	} catch (cause) {
		// The cause is carried rather than flattened into the message: when a fetch fails behind a
		// proxy or on a flaky connection, the underlying error is the part worth reading.
		throw new Error(`could not reach ${url}: ${cause.message}`, { cause });
	}

	if (!response.ok) {
		throw new Error(`${url} responded ${response.status} ${response.statusText}`);
	}

	const bytes = Buffer.from(await response.arrayBuffer());
	const text = gunzip ? gunzipSync(bytes).toString('utf-8') : bytes.toString('utf-8');

	writeFileSync(cachePath, text, 'utf-8');
	return text;
}
