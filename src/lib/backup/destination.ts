/**
 * Where the copy goes: the Termux reader service on this phone (ADR-0020,
 * contracts/reader-service.md). The only module that knows the address, so a second destination
 * (the deferred "back up now" file) is a second implementation here rather than a change elsewhere.
 */

import { session } from '$lib/storage/session';
import { readTar } from '$lib/media/tar';
import { isPlayable, isSubtitle, mediaFiles, saveMedia } from '$lib/media/store';
import { version } from '$app/environment';
import { open, seal, type CopyBody } from './format';

const SERVICE = 'http://127.0.0.1:8765';
const LAST_SENT = 'reader.lastCopy';

export type Found = { text: string; createdAt: string; documents: number; words: number };

async function reachable(): Promise<boolean> {
	try {
		return (await fetch(`${SERVICE}/health`, { cache: 'no-store' })).ok;
	} catch {
		return false;
	}
}

/** The reader's work now, sealed: the database's part from the worker, media subtitles from OPFS. */
export async function makeCopy(): Promise<string> {
	const { repository } = await session();
	const body = await repository.exportBody(version, new Date().toISOString());
	for (const document of body.documents) {
		const files = await mediaFiles(document.id);
		const subtitles = files.find((file) => isSubtitle(file.name));
		const meta = files.find((file) => file.name === 'meta.json');
		if (subtitles) {
			document.media = {
				subtitles: { name: subtitles.name, text: await subtitles.text() },
				meta: meta ? JSON.parse(await meta.text()) : {}
			};
		}
	}
	return JSON.stringify(await seal(body));
}

/** Send a copy; true when the service stored it. The time is kept for the safeguard notice. */
export async function send(text: string): Promise<boolean> {
	try {
		const response = await fetch(`${SERVICE}/backup`, { method: 'PUT', body: text });
		if (!response.ok) return false;
		try {
			localStorage.setItem(LAST_SENT, JSON.stringify({ at: Date.now(), bytes: text.length }));
		} catch {
			// Only the notice reads this, and a missing value reads as stale: it errs toward warning.
		}
		return true;
	} catch {
		return false;
	}
}

export function lastSent(): { at: number; bytes: number } | null {
	try {
		return JSON.parse(localStorage.getItem(LAST_SENT) ?? 'null');
	} catch {
		return null;
	}
}

/** The newest copy, 'none' when the service holds no copy yet, 'unreachable' when it is not running. */
export async function latest(): Promise<Found | 'none' | 'unreachable'> {
	if (!(await reachable())) return 'unreachable';
	const response = await fetch(`${SERVICE}/backup/latest`, { cache: 'no-store' });
	if (response.status === 404) return 'none';
	const text = await response.text();
	const copy = JSON.parse(text) as CopyBody;
	return {
		text,
		createdAt: copy.createdAt,
		documents: copy.documents.length,
		words: copy.states.length
	};
}

/**
 * Restore a copy, then put back what lives beside the database: each media document's subtitles
 * and metadata, and its video when Termux still has the bundle (research R8). Returns a refusal's
 * message, or null when the restore went through.
 */
export async function restore(text: string): Promise<string | null> {
	const body = await open(text);
	const { repository } = await session();
	const result = await repository.restoreCopy(body);
	if ('rejected' in result) return result.message;

	for (const document of body.documents) {
		const media = document.media;
		const id = result.restored.get(document.id);
		if (!media || id === undefined) continue;
		await saveMedia(id, [
			{ name: media.subtitles.name, blob: new Blob([media.subtitles.text]) },
			{ name: 'meta.json', blob: new Blob([JSON.stringify(media.meta)]) }
		]);
		await fetchVideo(id, media.meta).catch(() => {
			// The document reads without its video, and its page says so.
		});
	}
	return null;
}

/** For a media document restored without its video: look for it in Termux again. True if found. */
export async function findVideo(documentId: number): Promise<boolean> {
	const meta = (await mediaFiles(documentId)).find((file) => file.name === 'meta.json');
	if (!meta) return false;
	try {
		return await fetchVideo(documentId, JSON.parse(await meta.text()));
	} catch {
		return false;
	}
}

async function fetchVideo(documentId: number, meta: Record<string, unknown>): Promise<boolean> {
	let job = typeof meta.job === 'string' ? meta.job : undefined;
	if (!job && typeof meta.id === 'string') {
		const found = await fetch(`${SERVICE}/media/${encodeURIComponent(meta.id)}`);
		if (found.ok) job = (await found.json()).job;
	}
	if (!job) return false;
	const bundle = await fetch(`${SERVICE}/downloads/${encodeURIComponent(job)}/bundle.tar`);
	if (!bundle.ok) return false;
	const video = (await readTar(await bundle.blob())).find((member) => isPlayable(member.name));
	if (!video) return false;
	await saveMedia(documentId, [{ name: video.name.split('/').pop()!, blob: video.blob }]);
	return true;
}
