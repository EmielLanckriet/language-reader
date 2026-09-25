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
	meta: Record<string, unknown>;
}

async function mediaRoot(): Promise<FileSystemDirectoryHandle> {
	const root = await navigator.storage.getDirectory();
	return root.getDirectoryHandle('media', { create: true });
}

export async function saveMedia(
	documentId: number,
	files: { name: string; blob: Blob }[]
): Promise<void> {
	const directory = await (
		await mediaRoot()
	).getDirectoryHandle(String(documentId), {
		create: true
	});
	for (const { name, blob } of files) {
		const handle = await directory.getFileHandle(name, { create: true });
		const writable = await handle.createWritable();
		await writable.write(blob);
		await writable.close();
	}
}

export function isSubtitle(name: string): boolean {
	return /\.(vtt|srt)$/i.test(name);
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
	const found: StoredMedia = { media: undefined, cues: [], meta: {} };
	for await (const handle of directory.values()) {
		if (handle.kind !== 'file') continue;
		const file = await (handle as FileSystemFileHandle).getFile();
		if (isPlayable(file.name)) found.media = file;
		else if (isSubtitle(file.name)) found.cues = parseSubtitles(await file.text());
		else if (file.name === 'meta.json') found.meta = JSON.parse(await file.text());
	}
	return found;
}
