/**
 * What the library shows beside a title: a picture, the title in English, and how much of the text
 * the reader knows. All derived (ADR-0003), made once and kept beside the video.
 */
import { session } from '$lib/storage/session';
import { textShares, type Shares } from '$lib/domain/shares';
import { quickTranslation, quickTranslatorPresent } from '$lib/translation/quick';
import type { DocumentId } from '$lib/domain/types';
import {
	isPlayable,
	isSubtitle,
	mediaFiles,
	readMediaJson,
	saveMedia,
	writeMediaJson,
	THUMBNAIL
} from './store';

const ENGLISH_TITLE = 'title.en.json';
const WIDTH = 320;

/** A frame a tenth of the way in (at most a minute): past an intro card, usually the subject. */
async function frameOf(video: Blob): Promise<Blob | undefined> {
	const element = document.createElement('video');
	element.muted = true;
	element.preload = 'auto';
	const url = URL.createObjectURL(video);
	try {
		element.src = url;
		await new Promise((resolve, reject) => {
			element.onloadeddata = resolve;
			element.onerror = () => reject(new Error('The video could not be read.'));
		});
		if (!element.videoWidth) return undefined; // audio only
		element.currentTime = Math.min(60, Math.max(1, element.duration * 0.1));
		await new Promise((resolve) => (element.onseeked = resolve));
		const canvas = document.createElement('canvas');
		canvas.width = WIDTH;
		canvas.height = Math.round((WIDTH * element.videoHeight) / element.videoWidth);
		canvas.getContext('2d')!.drawImage(element, 0, 0, canvas.width, canvas.height);
		return await new Promise<Blob | undefined>((resolve) =>
			canvas.toBlob((blob) => resolve(blob ?? undefined), 'image/jpeg', 0.8)
		);
	} finally {
		element.removeAttribute('src');
		element.load();
		URL.revokeObjectURL(url);
	}
}

let frames = Promise.resolve();

/** The video's picture: YouTube's from the bundle, or a frame, taken one video at a time. */
export async function thumbnailOf(documentId: DocumentId): Promise<Blob | undefined> {
	const files = await mediaFiles(documentId);
	const kept = files.find((file) => file.name === THUMBNAIL);
	if (kept) return kept;
	// The video itself: beside it may be sound-only.m4a, the audio kept for listening in the background.
	const media = files.find((file) => isPlayable(file.name) && /\.(mp4|webm)$/i.test(file.name));
	if (!media) return undefined;
	const taken = frames.then(() => frameOf(media).catch(() => undefined));
	frames = taken.then(() => undefined);
	const frame = await taken;
	if (frame) await saveMedia(documentId, [{ name: THUMBNAIL, blob: frame }]);
	return frame;
}

/**
 * A YouTube title's parts: 【年度总结】一口气了解过去一年的全球经济｜关税战新格局 is three. Translated
 * whole, quick English kept only "[annual summary]" of that (measured on the phone); part by part it
 * keeps each.
 */
export function titleParts(title: string): string[] {
	const parts = title
		.split(/[【】[\]｜|丨]+/)
		.map((part) => part.trim())
		.filter(Boolean);
	return parts.length > 0 ? parts : [title];
}

/** Bumped when the way titles are translated changes, so a kept one is translated again. */
const TITLE_METHOD = 2;

/**
 * English titles, from what was kept, else from quick English (ADR-0023) when its model is already
 * on the device: the library never starts that download itself.
 */
export async function englishTitles(
	documents: { id: DocumentId; title: string }[],
	onTitle: (id: DocumentId, english: string) => void
): Promise<() => void> {
	const missing: { id: DocumentId; title: string; parts: string[] }[] = [];
	for (const document of documents) {
		const kept = await readMediaJson<{ chinese: string; english: string; method?: number }>(
			document.id,
			ENGLISH_TITLE
		);
		if (kept?.chinese === document.title && kept.method === TITLE_METHOD)
			onTitle(document.id, kept.english);
		else missing.push({ ...document, parts: titleParts(document.title) });
	}
	if (missing.length === 0 || !(await quickTranslatorPresent())) return () => {};
	// One line per part, in order; a title is done when all of its parts are.
	const lines = missing.flatMap((document) => document.parts);
	const owner = missing.flatMap((document, i) => document.parts.map(() => i));
	const english: (string | undefined)[] = lines.map(() => undefined);
	const translator = quickTranslation(
		() => lines,
		(i) => english[i] !== undefined,
		(i, text) => {
			english[i] = text.trim();
			const d = owner[i];
			const parts = english.filter((_, j) => owner[j] === d);
			if (parts.some((part) => part === undefined)) return;
			const { id, title } = missing[d];
			const joined = parts.filter(Boolean).join(' · ');
			onTitle(id, joined);
			void writeMediaJson(id, ENGLISH_TITLE, {
				chinese: title,
				english: joined,
				method: TITLE_METHOD
			});
		},
		() => {}
	);
	return () => translator.stop();
}

/** A video's length in ms: yt-dlp's duration, or where its last subtitle ends. */
async function durationOf(documentId: DocumentId): Promise<number | undefined> {
	const meta = await readMediaJson<{ duration?: number }>(documentId, 'meta.json');
	if (typeof meta?.duration === 'number' && meta.duration > 0) return meta.duration * 1000;
	const vtt = (await mediaFiles(documentId)).find((file) => isSubtitle(file.name));
	const ends = [...((await vtt?.text()) ?? '').matchAll(/--> *(?:(\d+):)?(\d+):(\d+)[.,](\d+)/g)];
	const last = ends.at(-1);
	if (!last) return undefined;
	const [, h = '0', m, sec, ms] = last;
	return (
		((Number(h) * 60 + Number(m)) * 60 + Number(sec)) * 1000 + Number(ms.padEnd(3, '0').slice(0, 3))
	);
}

/** How far into each video the reader got, as a fraction: the furthest point played. */
export async function progressOf(ids: DocumentId[]): Promise<Map<DocumentId, number>> {
	const { repository } = await session();
	const through = await repository.playedThrough(ids);
	const found = new Map<DocumentId, number>();
	for (const [id, ms] of through) {
		const duration = await durationOf(id);
		if (duration && ms > 0) found.set(id, Math.min(1, ms / duration));
	}
	return found;
}

/** Each document's shares of known, learning and new words, as of now. */
export async function sharesOf(ids: DocumentId[]): Promise<Map<DocumentId, Shares>> {
	const { repository } = await session();
	const occurrences = await repository.wordOccurrences(ids);
	const lexemes = [...new Set([...occurrences.values()].flatMap((words) => [...words.keys()]))];
	const [states, memory] = await Promise.all([
		repository.getStates(lexemes),
		repository.getMemory(lexemes)
	]);
	const now = new Date();
	const found = new Map<DocumentId, Shares>();
	for (const [id, words] of occurrences) {
		const shares = textShares(words, states, memory.memory, now, memory.parameters);
		if (shares) found.set(id, shares);
	}
	return found;
}
