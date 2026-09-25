/**
 * The files a media document was imported from, kept verbatim beside the database.
 *
 * In the origin-private file system under `media/<documentId>/`, which SQLite's pool (in
 * `.opfs-sahpool`) never touches. No table records them: a document has media exactly when its
 * directory exists, so there is nothing to keep in step.
 */

import { parseSubtitles, type Cue } from './subtitles';

export interface StoredMedia {
	media: File | undefined;
	cues: Cue[];
	/** English per cue, in cue order; empty until Termux has translated it. Derived. */
	translation: Cue[];
	meta: Record<string, unknown>;
}

async function mediaRoot(): Promise<FileSystemDirectoryHandle> {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle('media', { create: true });
}

export interface NamedBlob {
	name: string;
	blob: Blob;
}

async function directoryAt(path: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
	let directory = await mediaRoot();
	for (const part of path) directory = await directory.getDirectoryHandle(part, { create });
	return directory;
}

async function writeFiles(directory: FileSystemDirectoryHandle, files: NamedBlob[]) {
	for (const { name, blob } of files) {
		const handle = await directory.getFileHandle(name, { create: true });
		const writable = await handle.createWritable();
		await writable.write(blob);
		await writable.close();
	}
}

export async function saveMedia(documentId: number, files: NamedBlob[]): Promise<void> {
	await writeFiles(await directoryAt([String(documentId)], true), files);
}

/**
 * A video whose transcript is still arriving from Termux (ADR-0019). No document exists yet: it is
 * created, and these files copied to it, when the transcript is complete.
 */
export async function savePending(job: string, files: NamedBlob[]): Promise<void> {
	await writeFiles(await directoryAt(['pending', job], true), files);
}

async function filesAt(path: string[]): Promise<File[]> {
	const files: File[] = [];
	for await (const handle of (await directoryAt(path, false)).values()) {
		if (handle.kind === 'file') files.push(await (handle as FileSystemFileHandle).getFile());
	}
	return files;
}

export function loadPending(job: string): Promise<File[]> {
	return filesAt(['pending', job]);
}

/** The files kept for a media document, or none when it is not one (ADR-0018). */
export async function mediaFiles(documentId: number): Promise<File[]> {
	try {
		return await filesAt([String(documentId)]);
	} catch {
		return [];
	}
}

export async function removePending(job: string): Promise<void> {
	await (await directoryAt(['pending'], false)).removeEntry(job, { recursive: true });
}

/** A Chinese subtitle track: any .vtt or .srt except the English one translate.py writes. */
export function isSubtitle(name: string): boolean {
	return /\.(vtt|srt)$/i.test(name) && !isTranslation(name);
}

export function isTranslation(name: string): boolean {
	return /\.en\.vtt$/i.test(name);
}

export function isPlayable(name: string): boolean {
	return /\.(mp4|webm|m4a|mp3|ogg|opus|wav)$/i.test(name);
}

export async function loadMedia(documentId: number): Promise<StoredMedia | null> {
	let directory: FileSystemDirectoryHandle;
	try {
		directory = await (await mediaRoot()).getDirectoryHandle(String(documentId));
	} catch {
		return null;
	}
	const found: StoredMedia = { media: undefined, cues: [], translation: [], meta: {} };
	for await (const handle of directory.values()) {
		if (handle.kind !== 'file') continue;
		const file = await (handle as FileSystemFileHandle).getFile();
		if (isPlayable(file.name)) found.media = file;
		else if (isSubtitle(file.name)) found.cues = parseSubtitles(await file.text());
		else if (isTranslation(file.name)) found.translation = parseSubtitles(await file.text());
		else if (file.name === 'meta.json') found.meta = JSON.parse(await file.text());
	}
	return found;
}
