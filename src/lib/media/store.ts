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
	/** The quick model's English per cue, null where not yet translated (ADR-0023). Derived. */
	quick: (string | null)[];
	meta: Record<string, unknown>;
	/** The video's sound as an audio-only file, once made (SOUND_ONLY). */
	sound?: File;
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
 * A video whose transcript Reader is still writing (spec 008, ADR-0029). No document exists yet: it
 * is created, and these files copied to it, when the transcript is complete.
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

/** A deleted document's files; nothing to do when it had none. */
export async function removeMedia(documentId: number): Promise<void> {
	try {
		await (await mediaRoot()).removeEntry(String(documentId), { recursive: true });
	} catch {
		// Not a media document, or already gone.
	}
}

export async function removePending(job: string): Promise<void> {
	await (await directoryAt(['pending'], false)).removeEntry(job, { recursive: true });
}

/**
 * Beside a pending video (spec 008, data-model.md). All derived: recomputable from the video.
 * `pending.json` says when it was imported, for the transcriber's order; `transcript.json` is the
 * transcript so far, so it can resume.
 */
export const PENDING_INFO = 'pending.json';
export const TRANSCRIPT = 'transcript.json';
/** Beside a finished transcript: what produced it (FR-012), and whether Termux has it (FR-019). */
export const TRANSCRIPT_METHOD = 'media.zh.method.json';
export const TRANSCRIPT_SENT = 'transcript-sent';

async function readJsonIn<T>(
	directory: FileSystemDirectoryHandle,
	name: string
): Promise<T | undefined> {
	try {
		return JSON.parse(await (await (await directory.getFileHandle(name)).getFile()).text()) as T;
	} catch {
		return undefined;
	}
}

/** Written aside and moved into place, so an interruption leaves the previous whole version. */
async function writeJsonIn(
	directory: FileSystemDirectoryHandle,
	name: string,
	value: unknown
): Promise<void> {
	const aside = await directory.getFileHandle(`${name}.part`, { create: true });
	const writable = await aside.createWritable();
	await writable.write(JSON.stringify(value));
	await writable.close();
	await (aside as FileSystemFileHandle & { move(name: string): Promise<void> }).move(name);
}

export async function readPending<T>(job: string, name: string): Promise<T | undefined> {
	try {
		return await readJsonIn<T>(await directoryAt(['pending', job], false), name);
	} catch {
		return undefined;
	}
}

export async function writePending(job: string, name: string, value: unknown): Promise<void> {
	await writeJsonIn(await directoryAt(['pending', job], true), name, value);
}

/** The pending videos, by folder name. */
export async function listPending(): Promise<string[]> {
	const jobs: string[] = [];
	for await (const entry of (await directoryAt(['pending'], true)).values()) {
		if (entry.kind === 'directory') jobs.push(entry.name);
	}
	return jobs;
}

export async function readMediaJson<T>(documentId: number, name: string): Promise<T | undefined> {
	try {
		return await readJsonIn<T>(await directoryAt([String(documentId)], false), name);
	} catch {
		return undefined;
	}
}

export async function writeMediaJson(
	documentId: number,
	name: string,
	value: unknown
): Promise<void> {
	await writeJsonIn(await directoryAt([String(documentId)], true), name, value);
}

/** A Chinese subtitle track: any .vtt or .srt except the English one translate.py writes. */
export function isSubtitle(name: string): boolean {
	return /\.(vtt|srt)$/i.test(name) && !isTranslation(name);
}

export function isTranslation(name: string): boolean {
	return /\.en\.vtt$/i.test(name);
}

/** Kept apart from the LLM's media.en.vtt, so neither translator can overwrite the other. */
export const QUICK_ENGLISH = 'quick-english.json';

/** The video's sound alone, for listening with the screen locked (media/audio-track.ts). Derived. */
export const SOUND_ONLY = 'sound-only.m4a';

/** The library's picture of a video: YouTube's (via Termux), or a frame Reader took from it. */
export const THUMBNAIL = 'thumbnail.jpg';

export function isPicture(name: string): boolean {
	return /\.(jpe?g|png|webp)$/i.test(name);
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
	const found: StoredMedia = { media: undefined, cues: [], translation: [], quick: [], meta: {} };
	for await (const handle of directory.values()) {
		if (handle.kind !== 'file') continue;
		const file = await (handle as FileSystemFileHandle).getFile();
		if (file.name === SOUND_ONLY) found.sound = file;
		else if (isPlayable(file.name)) found.media = file;
		else if (isSubtitle(file.name)) found.cues = parseSubtitles(await file.text());
		else if (isTranslation(file.name)) found.translation = parseSubtitles(await file.text());
		else if (file.name === 'meta.json') found.meta = JSON.parse(await file.text());
		else if (file.name === QUICK_ENGLISH) found.quick = JSON.parse(await file.text());
	}
	return found;
}

/**
 * Termux jobs already imported, from the meta.json kept with each media document and each pending
 * transcript (termux-url-opener records the job). What "New from Termux" leaves out.
 */
/**
 * Termux jobs the reader does not want offered again: a video they deleted, or one they dismissed
 * from New from Termux. Deleting a document removes the meta.json that marked its job as imported,
 * so without this list it came back as new.
 */
const DISMISSED = 'dismissed.json';

async function dismissedJobs(): Promise<string[]> {
	try {
		const file = await (await (await mediaRoot()).getFileHandle(DISMISSED)).getFile();
		return JSON.parse(await file.text());
	} catch {
		return [];
	}
}

/** One at a time: two quick taps each read the list before the other wrote it, and one was lost. */
let dismissing: Promise<void> = Promise.resolve();

export function dismissJob(job: string): Promise<void> {
	dismissing = dismissing.then(async () => {
		const jobs = await dismissedJobs();
		if (jobs.includes(job)) return;
		await writeFiles(await mediaRoot(), [
			{ name: DISMISSED, blob: new Blob([JSON.stringify([...jobs, job])]) }
		]);
	});
	return dismissing;
}

export async function importedJobs(): Promise<Set<string>> {
	const jobs = new Set<string>(await dismissedJobs());
	const read = async (directory: FileSystemDirectoryHandle) => {
		try {
			const meta = await (await directory.getFileHandle('meta.json')).getFile();
			const job = JSON.parse(await meta.text()).job;
			if (typeof job === 'string') jobs.add(job);
		} catch {
			// Not a media document from Termux.
		}
	};
	const root = await mediaRoot();
	for await (const entry of root.values()) {
		if (entry.kind !== 'directory') continue;
		if (entry.name !== 'pending') await read(entry as FileSystemDirectoryHandle);
		else {
			for await (const job of (entry as FileSystemDirectoryHandle).values()) {
				if (job.kind === 'directory') await read(job as FileSystemDirectoryHandle);
			}
		}
	}
	return jobs;
}

/** The documents that are videos: those with a media folder, which a restored video keeps too. */
export async function mediaDocuments(): Promise<Set<number>> {
	const ids = new Set<number>();
	for await (const entry of (await mediaRoot()).values()) {
		if (entry.kind === 'directory' && /^\d+$/.test(entry.name)) ids.add(Number(entry.name));
	}
	return ids;
}
