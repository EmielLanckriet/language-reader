/**
 * The speech model on the device (research R5, data-model.md). Read here, by the worker too;
 * downloaded by model-download.ts. Derived: lost, it is downloaded again (ADR-0003).
 */
import meta from './sense-voice-meta.json';

/** A pinned revision, so the file cannot change under the checksum. */
export const REVISION = meta.revision;
export const SOURCE = `https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/${REVISION}`;

export const FILES = [
	{
		name: 'model.int8.onnx',
		size: 239_233_841,
		sha256: 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51'
	},
	{
		name: 'tokens.txt',
		size: 315_894,
		sha256: 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc'
	}
] as const;

/** The runtime a transcript and a calibration were made with (package.json pins it exactly). */
export const RUNTIME = 'onnxruntime-web 1.30.0';

export const TOTAL_BYTES = FILES.reduce((n, f) => n + f.size, 0);

export async function speechRoot(): Promise<FileSystemDirectoryHandle> {
	return (await navigator.storage.getDirectory()).getDirectoryHandle('speech', { create: true });
}

export async function revisionDir(revision = REVISION): Promise<FileSystemDirectoryHandle> {
	return (await speechRoot()).getDirectoryHandle(revision, { create: true });
}

export async function readJson<T>(
	dir: FileSystemDirectoryHandle,
	name: string
): Promise<T | undefined> {
	try {
		return JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text()) as T;
	} catch {
		return undefined;
	}
}

export interface Verified {
	revision: string;
	sha256: Record<string, string>;
	at: string;
}

export type ModelState =
	{ kind: 'present' } | { kind: 'partial'; bytes: number } | { kind: 'missing' };

export async function modelState(): Promise<ModelState> {
	try {
		const dir = await revisionDir();
		if ((await readJson<Verified>(dir, 'verified.json'))?.revision === REVISION)
			return { kind: 'present' };
		const progress = await readJson<{ files: Record<string, number> }>(dir, 'download.json');
		const bytes = Object.values(progress?.files ?? {}).reduce((n, b) => n + b, 0);
		return bytes ? { kind: 'partial', bytes } : { kind: 'missing' };
	} catch {
		return { kind: 'missing' };
	}
}

/** The verified model's files, for the worker. */
export async function modelFiles(revision = REVISION): Promise<{ model: File; tokens: File }> {
	const dir = await revisionDir(revision);
	if ((await readJson<Verified>(dir, 'verified.json'))?.revision !== revision) {
		throw new Error('The speech model is not downloaded.');
	}
	const file = async (name: string) => (await dir.getFileHandle(name)).getFile();
	return { model: await file('model.int8.onnx'), tokens: await file('tokens.txt') };
}
