/**
 * The native build (ADR-0047): the same app bundled into an Android shell, built with
 * `npm run build:native`. Its database lives in a file of the app's own instead of browser storage.
 */
export const NATIVE = import.meta.env.MODE === 'native';

interface TauriInternals {
	invoke<T>(command: string, args?: unknown): Promise<T>;
}

/** Call a command of the shell. Page only. */
export function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
	const internals = (globalThis as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
	if (!internals) return Promise.reject(new Error(`No native shell for ${command}`));
	return internals.invoke<T>(command, args);
}

/**
 * The database file, fetched whole. Through a URL scheme of the shell's rather than `invoke`: on
 * Android every invoke is JSON, and 36 MB of bytes as a JSON array is out of the question.
 */
export async function loadDatabaseFile(): Promise<ArrayBuffer> {
	const android = navigator.userAgent.includes('Android');
	const response = await fetch(android ? 'http://readerdb.localhost/' : 'readerdb://localhost/');
	if (!response.ok) throw new Error(`Loading the database: ${await response.text()}`);
	return response.arrayBuffer();
}

const PART = 1 << 20;

/** One batch, as base64 parts the shell appends as one record when the last one arrives. */
export async function commitDatabaseBatch(batch: ArrayBuffer): Promise<void> {
	const bytes = new Uint8Array(batch);
	for (let at = 0; ; at += PART) {
		const last = at + PART >= bytes.length;
		await invoke('db_commit', { part: base64(bytes.subarray(at, at + PART)), last });
		if (last) return;
	}
}

function base64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}
