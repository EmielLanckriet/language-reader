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
	const media = files.find((file) => isPlayable(file.name));
	if (!media) return undefined;
	const taken = frames.then(() => frameOf(media).catch(() => undefined));
	frames = taken.then(() => undefined);
	const frame = await taken;
	if (frame) await saveMedia(documentId, [{ name: THUMBNAIL, blob: frame }]);
	return frame;
}

/**
 * English titles, from what was kept, else from quick English (ADR-0023) when its model is already
 * on the device: the library never starts that download itself.
 */
export async function englishTitles(
	documents: { id: DocumentId; title: string }[],
	onTitle: (id: DocumentId, english: string) => void
): Promise<() => void> {
	const missing: { id: DocumentId; title: string }[] = [];
	for (const document of documents) {
		const kept = await readMediaJson<{ chinese: string; english: string }>(
			document.id,
			ENGLISH_TITLE
		);
		if (kept?.chinese === document.title) onTitle(document.id, kept.english);
		else missing.push(document);
	}
	if (missing.length === 0 || !(await quickTranslatorPresent())) return () => {};
	const done = new Set<number>();
	const translator = quickTranslation(
		() => missing.map((document) => document.title),
		(i) => done.has(i),
		(i, english) => {
			done.add(i);
			const { id, title } = missing[i];
			onTitle(id, english);
			void writeMediaJson(id, ENGLISH_TITLE, { chinese: title, english });
		},
		() => {}
	);
	return () => translator.stop();
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
