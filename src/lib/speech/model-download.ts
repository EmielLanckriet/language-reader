/**
 * Downloading the speech model, once (research R5, FR-009). Main thread only.
 *
 * In 16 MB ranges written at their offsets, with the bytes done recorded after each, so an
 * interrupted download continues rather than starting again: the existing `downloadInto` streams a
 * whole file into the Cache API, which cannot be appended to, and 239 MB is too much to lose to a
 * dropped connection. Checked against the checksums once complete; a file that fails is deleted.
 */
import { base } from '$app/paths';
import { downloadInto } from '$lib/analyzer/model-store';
import { MODEL_CACHE, RUNTIME_PATHS } from '$lib/analyzer/model-cache';
import {
	FILES,
	REVISION,
	SOURCE,
	TOTAL_BYTES,
	readJson,
	revisionDir,
	speechRoot,
	modelState,
	type Verified
} from './model';

const RANGE = 16 * 1024 * 1024;

export type DownloadProblem = 'no room' | 'unreachable' | 'corrupt';

export class ModelDownloadError extends Error {
	constructor(
		readonly problem: DownloadProblem,
		message: string
	) {
		super(message);
	}
}

async function writeJson(
	dir: FileSystemDirectoryHandle,
	name: string,
	value: unknown
): Promise<void> {
	const writable = await (await dir.getFileHandle(name, { create: true })).createWritable();
	await writable.write(JSON.stringify(value));
	await writable.close();
}

async function sha256(file: File): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The runtime is shared with the other two models; fetched here too when missing. */
async function ensureRuntime(): Promise<void> {
	const cache = await caches.open(MODEL_CACHE);
	const urls = RUNTIME_PATHS.map((path) => `${base}${path}`);
	const missing = [];
	for (const url of urls) if (!(await cache.match(url))) missing.push(url);
	if (missing.length) await downloadInto(missing, 'the speech runtime');
}

/**
 * Download what is missing, reporting bytes on the device out of the total. Resolves when the model
 * is present and verified.
 */
export async function downloadModel(
	onProgress: (bytes: number, total: number) => void,
	signal?: AbortSignal
): Promise<void> {
	const state = await modelState();
	if (state.kind === 'present') return ensureRuntime();
	const done = state.kind === 'partial' ? state.bytes : 0;
	const estimate = await navigator.storage.estimate();
	if (
		estimate.quota !== undefined &&
		estimate.usage !== undefined &&
		estimate.quota - estimate.usage < TOTAL_BYTES - done
	) {
		throw new ModelDownloadError(
			'no room',
			'There is not enough room on the device for the speech model.'
		);
	}

	const dir = await revisionDir();
	const progress = (await readJson<{ revision: string; files: Record<string, number> }>(
		dir,
		'download.json'
	)) ?? {
		revision: REVISION,
		files: {}
	};
	const onDevice = () => Object.values(progress.files).reduce((n, b) => n + b, 0);
	onProgress(onDevice(), TOTAL_BYTES);

	for (const file of FILES) {
		const handle = await dir.getFileHandle(file.name, { create: true });
		let at = progress.files[file.name] ?? 0;
		while (at < file.size) {
			const end = Math.min(at + RANGE, file.size) - 1;
			let response: Response;
			try {
				response = await fetch(`${SOURCE}/${file.name}`, {
					headers: { Range: `bytes=${at}-${end}` },
					signal
				});
			} catch (error) {
				if (signal?.aborted) throw error;
				throw new ModelDownloadError('unreachable', 'The speech model could not be fetched.');
			}
			if (response.status !== 206) {
				throw new ModelDownloadError(
					'unreachable',
					`The speech model could not be fetched (${response.status}).`
				);
			}
			const bytes = new Uint8Array(await response.arrayBuffer());
			const writable = await handle.createWritable({ keepExistingData: true });
			await writable.seek(at);
			await writable.write(bytes);
			await writable.close();
			at += bytes.byteLength;
			progress.files[file.name] = at;
			await writeJson(dir, 'download.json', progress);
			onProgress(onDevice(), TOTAL_BYTES);
		}
	}

	const sums: Record<string, string> = {};
	for (const file of FILES) {
		sums[file.name] = await sha256(await (await dir.getFileHandle(file.name)).getFile());
		if (sums[file.name] !== file.sha256) {
			await dir.removeEntry(file.name);
			delete progress.files[file.name];
			await writeJson(dir, 'download.json', progress);
			throw new ModelDownloadError(
				'corrupt',
				'The downloaded speech model did not match its checksum and was removed.'
			);
		}
	}
	await writeJson(dir, 'verified.json', {
		revision: REVISION,
		sha256: sums,
		at: new Date().toISOString()
	} satisfies Verified);
	await ensureRuntime();

	// Folders of other revisions are rubbish once this one is present.
	const root = await speechRoot();
	for await (const [name, entry] of root.entries()) {
		if (entry.kind === 'directory' && name !== REVISION)
			await root.removeEntry(name, { recursive: true });
	}
}
