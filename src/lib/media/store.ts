/**
 * The files a media document was imported from, kept verbatim beside the database.
 *
 * Under `media/<documentId>/` in `files.ts`: OPFS in the browser, the app's own files natively
 * (ADR-0051). No table records them: a document has media exactly when its directory exists, so
 * there is nothing to keep in step.
 */

import { parseSubtitles, type Cue, type SubtitleTrack } from './subtitles';
import { LAYOUT, PLAIN, SENTENCES, layoutOf, type Layout } from './layout';
import { files as storage, type MediaFile, type Source } from './files';

export type { MediaFile } from './files';

export interface StoredMedia {
	media: MediaFile | undefined;
	cues: Cue[];
	/** English per cue, in cue order; empty until Termux has translated it. Derived. */
	translation: Cue[];
	/** The quick model's English per cue, null where not yet translated (ADR-0023). Derived. */
	quick: (string | null)[];
	meta: Record<string, unknown>;
	/** The video's sound as an audio-only file, once made (SOUND_ONLY). */
	sound?: MediaFile;
	/** Every downloaded subtitle track (spec 012), with its text; empty for older documents. */
	tracks: SubtitleTrack[];
	/** Which English the reader shows (ENGLISH_SETTING). Derived; absent means machine. */
	english: EnglishSetting;
	/** How the reader cut, timed and placed English on the lines (LAYOUT); plain when untouched. */
	layout: Layout;
}

/** The English a media document shows (spec 012): a human track, the translators, or none. */
export type EnglishSetting =
	| { source: 'track'; file: string }
	| { source: 'machine' }
	| { source: 'none' }
	/** English the reader placed on the lines by hand (layout.ts), kept in layout.json. */
	| { source: 'edited' };

const MEDIA = 'media';
const at = (...path: string[]) => [MEDIA, ...path];

export interface NamedBlob {
	name: string;
	blob: Source;
}

async function writeFiles(path: string[], files: NamedBlob[]) {
	for (const { name, blob } of files) await storage.write([...path, name], blob);
}

export async function saveMedia(documentId: number, files: NamedBlob[]): Promise<void> {
	await writeFiles(at(String(documentId)), files);
}

/**
 * A video whose transcript Reader is still writing (spec 008, ADR-0029). No document exists yet: it
 * is created, and these files copied to it, when the transcript is complete.
 */
export async function savePending(job: string, files: NamedBlob[]): Promise<void> {
	await writeFiles(at('pending', job), files);
}

export async function loadPending(job: string): Promise<MediaFile[]> {
	const found = await storage.files(at('pending', job));
	if (!found) throw new Error(`No pending video ${job}`);
	return found;
}

/** The files kept for a media document, or none when it is not one (ADR-0018). */
export async function mediaFiles(documentId: number): Promise<MediaFile[]> {
	return (await storage.files(at(String(documentId))).catch(() => null)) ?? [];
}

/** A deleted document's files; nothing to do when it had none. */
export async function removeMedia(documentId: number): Promise<void> {
	await storage.remove(at(String(documentId))).catch(() => {});
}

export async function removePending(job: string): Promise<void> {
	await storage.remove(at('pending', job));
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

async function readJson<T>(path: string[]): Promise<T | undefined> {
	try {
		const file = await storage.file(path);
		return file && (JSON.parse(await file.text()) as T);
	} catch {
		return undefined;
	}
}

/** Atomic in both stores: an interruption leaves the previous whole version. */
async function writeJson(path: string[], value: unknown): Promise<void> {
	await storage.write(path, new Blob([JSON.stringify(value)]));
}

export function readPending<T>(job: string, name: string): Promise<T | undefined> {
	return readJson<T>(at('pending', job, name));
}

export async function writePending(job: string, name: string, value: unknown): Promise<void> {
	await writeJson(at('pending', job, name), value);
}

/** The pending videos, by folder name. */
export async function listPending(): Promise<string[]> {
	const entries = (await storage.entries(at('pending'))) ?? [];
	return entries.filter((entry) => entry.kind === 'directory').map((entry) => entry.name);
}

export function readMediaJson<T>(documentId: number, name: string): Promise<T | undefined> {
	return readJson<T>(at(String(documentId), name));
}

export async function writeMediaJson(
	documentId: number,
	name: string,
	value: unknown
): Promise<void> {
	await writeJson(at(String(documentId), name), value);
}

/**
 * The Chinese track a document is read from: any .vtt or .srt except the English one translate.py
 * writes and the downloaded tracks kept beside it (spec 012), which are only candidates.
 */
export function isSubtitle(name: string): boolean {
	return /\.(vtt|srt)$/i.test(name) && !isTranslation(name) && !isTrack(name);
}

/** The machine English translate.py writes; never a downloaded human English track. */
export function isTranslation(name: string): boolean {
	return /\.en\.vtt$/i.test(name) && !isTrack(name);
}

/** A downloaded subtitle track as termux-url-opener names it: track.<lang>.vtt, track-auto.<lang>.vtt. */
export function isTrack(name: string): boolean {
	return /^track(-auto)?\.[^/]+\.vtt$/i.test(name);
}

/** What termux-url-opener says about each downloaded track. */
export const TRACKS = 'tracks.json';

/** The reader's English choice for a document (EnglishSetting). */
export const ENGLISH_SETTING = 'english.json';

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
	const files = await storage.files(at(String(documentId))).catch(() => null);
	if (!files) return null;
	const found: StoredMedia = {
		media: undefined,
		cues: [],
		translation: [],
		quick: [],
		meta: {},
		tracks: [],
		english: { source: 'machine' },
		layout: PLAIN
	};
	let manifest: Omit<SubtitleTrack, 'text'>[] = [];
	let layout: unknown;
	let runs: unknown;
	const texts = new Map<string, string>();
	for (const file of files) {
		// An interrupted write leaves the file it created empty (issue #45): no file, so a derived
		// sound is made again and a card plays the video instead.
		if (file.size === 0 && isPlayable(file.name)) continue;
		if (file.name === SOUND_ONLY) found.sound = file;
		else if (isPlayable(file.name)) found.media = file;
		else if (isSubtitle(file.name)) found.cues = parseSubtitles(await file.text());
		else if (isTranslation(file.name)) found.translation = parseSubtitles(await file.text());
		else if (file.name === 'meta.json') found.meta = JSON.parse(await file.text());
		else if (file.name === QUICK_ENGLISH) found.quick = JSON.parse(await file.text());
		else if (file.name === TRACKS) manifest = JSON.parse(await file.text());
		else if (file.name === ENGLISH_SETTING) found.english = JSON.parse(await file.text());
		else if (isTrack(file.name)) texts.set(file.name, await file.text());
		else if (file.name === LAYOUT) layout = JSON.parse(await file.text());
		else if (file.name === SENTENCES) runs = JSON.parse(await file.text());
	}
	found.layout = layoutOf(layout, runs);
	// The sound alone, downloaded again after its video was lost (media/redownload.ts), plays.
	found.media ??= found.sound;
	found.tracks = manifest.flatMap((track) => {
		const text = texts.get(track.file);
		return text === undefined ? [] : [{ ...track, text }];
	});
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
	return (await readJson<string[]>(at(DISMISSED))) ?? [];
}

/** One at a time: two quick taps each read the list before the other wrote it, and one was lost. */
let dismissing: Promise<void> = Promise.resolve();

export function dismissJob(job: string): Promise<void> {
	dismissing = dismissing.then(async () => {
		const jobs = await dismissedJobs();
		if (jobs.includes(job)) return;
		await writeJson(at(DISMISSED), [...jobs, job]);
	});
	return dismissing;
}

export async function importedJobs(): Promise<Set<string>> {
	const jobs = new Set<string>(await dismissedJobs());
	const read = async (path: string[]) => {
		const job = (await readJson<{ job?: unknown }>([...path, 'meta.json']))?.job;
		if (typeof job === 'string') jobs.add(job);
	};
	for (const entry of (await storage.entries(at())) ?? []) {
		if (entry.kind !== 'directory') continue;
		if (entry.name !== 'pending') await read(at(entry.name));
		else {
			for (const job of (await storage.entries(at('pending'))) ?? []) {
				if (job.kind === 'directory') await read(at('pending', job.name));
			}
		}
	}
	return jobs;
}

/** The documents that are videos: those with a media folder, which a restored video keeps too. */
export async function mediaDocuments(): Promise<Set<number>> {
	const ids = new Set<number>();
	for (const entry of (await storage.entries(at())) ?? []) {
		if (entry.kind === 'directory' && /^\d+$/.test(entry.name)) ids.add(Number(entry.name));
	}
	return ids;
}

/**
 * Moved, not copied, from one document's folder to another's: a video's own file is hundreds of
 * megabytes. For a video given new subtitles (issue #9).
 */
export async function moveMediaFiles(from: number, to: number, names: string[]): Promise<void> {
	for (const name of names) await storage.move(at(String(from), name), at(String(to), name));
}

/** Each media document's meta.json, by document. */
async function metas(): Promise<Map<number, Record<string, unknown>>> {
	const found = new Map<number, Record<string, unknown>>();
	for (const id of await mediaDocuments()) {
		const meta = await readMediaJson<Record<string, unknown>>(id, 'meta.json');
		if (meta) found.set(id, meta);
	}
	return found;
}

/** The documents a video's earlier subtitles were, which its meta.json records (issue #9). */
export function replacesIn(meta: Record<string, unknown>): number[] {
	return Array.isArray(meta.replaces) ? meta.replaces.filter((id) => typeof id === 'number') : [];
}

/**
 * Videos whose documents asked Termux to download them again (media/redownload.ts): by YouTube id,
 * and by title for a download still in progress, whose listing has no id yet.
 */
export async function awaitedVideos(): Promise<{ ids: Set<string>; titles: Set<string> }> {
	const ids = new Set<string>();
	const titles = new Set<string>();
	for (const meta of (await metas()).values()) {
		if (typeof meta.redownload !== 'string') continue;
		if (typeof meta.id === 'string') ids.add(meta.id);
		if (typeof meta.title === 'string') titles.add(meta.title);
	}
	return { ids, titles };
}

/** The library's document for this YouTube video, if it has one. */
export async function videoDocument(youtubeId: string): Promise<number | undefined> {
	for (const [id, meta] of await metas()) if (meta.id === youtubeId) return id;
	return undefined;
}

/**
 * Each document some video's later subtitles replaced, to the document that video is now: not
 * deleted by the reader, and still that video for whatever pointed at it.
 */
export async function replacements(): Promise<Map<number, number>> {
	return new Map(
		[...(await metas())].flatMap(([id, meta]) => replacesIn(meta).map((old) => [old, id] as const))
	);
}
