/**
 * Where the copy goes: the Termux reader service on this phone (ADR-0020,
 * contracts/reader-service.md). The only module that knows the address, so a second destination
 * (the deferred "back up now" file) is a second implementation here rather than a change elsewhere.
 */

import { session } from '$lib/storage/session';
import { readTar } from '$lib/media/tar';
import { isPlayable, isSubtitle, mediaFiles, replacesIn, saveMedia } from '$lib/media/store';
import { version } from '$app/environment';
import {
	holdsNothing,
	mergeChain,
	open,
	openIncrement,
	seal,
	sealPiece,
	trimDocuments,
	type CopyBody,
	type CopyCursor,
	type CopyDocument
} from './format';

import { SERVICE } from '$lib/media/service-address';
const LAST_SENT = 'reader.lastCopy';

export type Found = { text: string; createdAt: string; documents: number; words: number };

async function reachable(): Promise<boolean> {
	try {
		return (await fetch(`${SERVICE}/health`, { cache: 'no-store' })).ok;
	} catch {
		return false;
	}
}

/**
 * Where the chain of copies Termux holds stands (ADR-0048): the cursor after the last piece it
 * took, the mark of every document as last sent, and when the chain's full copy was made.
 */
interface Chain {
	cursor: CopyCursor;
	sent: Record<number, string>;
	startedAt: number;
}
const CHAIN = 'reader.copyChain';
/** A fresh full copy this often, and only while the app is hidden, so a restore stays short. */
const RESTART_CHAIN_MS = 7 * 86_400_000;

function readChain(): Chain | null {
	try {
		return JSON.parse(localStorage.getItem(CHAIN) ?? 'null');
	} catch {
		return null;
	}
}

function writeChain(chain: Chain | null) {
	try {
		if (chain) localStorage.setItem(CHAIN, JSON.stringify(chain));
		else localStorage.removeItem(CHAIN);
	} catch {
		// Without it every copy is a full one, as before chains: slower, never wrong.
	}
}

/**
 * What tells a changed document from the one last sent, without reading its subtitles: a
 * document's text never changes in place, and its files say when they were written.
 */
async function marksOf(documents: CopyDocument[]): Promise<Record<number, string>> {
	const marks: Record<number, string> = {};
	for (const document of documents) {
		const files = (await mediaFiles(document.id))
			.filter((file) => isSubtitle(file.name) || file.name === 'meta.json')
			.map((file) => `${file.name}:${file.size}:${file.lastModified}`)
			.sort();
		marks[document.id] = [
			document.title,
			document.createdAt,
			document.removedAt ?? '',
			document.rawContent.length,
			...files
		].join('|');
	}
	return marks;
}

/** Attach each document's subtitles and metadata from OPFS, as a copy carries them. */
async function withMedia(documents: CopyDocument[]): Promise<void> {
	for (const document of documents) {
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
}

/**
 * Bring Termux up to date; true when it holds everything (or there is nothing earned to hold).
 * An increment while the chain holds; a full copy to start one, when the worker says history no
 * longer adds up, when Termux says the increment does not follow, and weekly while hidden.
 */
export async function copyNow(hidden: boolean): Promise<boolean> {
	const { repository } = await session();
	const chain = readChain();
	const createdAt = new Date().toISOString();
	const restart = !chain || (hidden && Date.now() - chain.startedAt > RESTART_CHAIN_MS);
	if (chain && !restart) {
		const next = await repository.exportIncrement(version, createdAt, chain.cursor);
		if (next) {
			const marks = await marksOf(next.increment.documents);
			const { increment, sent } = trimDocuments(chain.sent, next.increment, marks);
			await withMedia(increment.documents);
			const text = JSON.stringify(await sealPiece(increment));
			let response: Response;
			try {
				response = await fetch(`${SERVICE}/backup/increment`, { method: 'PUT', body: text });
			} catch {
				return false; // unreachable: try again later, the chain unchanged
			}
			if (response.status === 204) {
				writeChain({ ...chain, cursor: next.cursor, sent });
				noteSent(text.length);
				return true;
			}
			// Refused (it does not follow what Termux holds), or a Termux from before chains: a
			// full copy, now.
		}
	}
	writeChain(null);
	const { body, cursor } = await repository.exportCopy(version, createdAt);
	if (holdsNothing(body)) return true;
	const marks = await marksOf(body.documents);
	await withMedia(body.documents);
	const text = JSON.stringify(await seal(body));
	if (!(await send(text))) return false;
	writeChain({ cursor, sent: marks, startedAt: Date.now() });
	return true;
}

function noteSent(bytes: number) {
	try {
		localStorage.setItem(LAST_SENT, JSON.stringify({ at: Date.now(), bytes }));
	} catch {
		// Only the notice reads this, and a missing value reads as stale: it errs toward warning.
	}
}

/** Send a copy; true when the service stored it. The time is kept for the safeguard notice. */
export async function send(text: string): Promise<boolean> {
	try {
		const response = await fetch(`${SERVICE}/backup`, { method: 'PUT', body: text });
		if (!response.ok) return false;
		noteSent(text.length);
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
	const chain = await fetch(`${SERVICE}/backup/chain`, { cache: 'no-store' });
	if (chain.ok) {
		// The full copy and its increments, each checked, merged into the copy they stand for.
		const { base, increments } = (await chain.json()) as { base: unknown; increments: unknown[] };
		const body = await open(JSON.stringify(base));
		const pieces = [];
		for (const piece of increments) pieces.push(await openIncrement(JSON.stringify(piece)));
		const merged = mergeChain(body, pieces);
		return {
			text: JSON.stringify(await seal(merged)),
			createdAt: merged.createdAt,
			documents: merged.documents.length,
			words: merged.states.length
		};
	}
	// Otherwise a Termux from before chains (ADR-0048), or none yet: its latest full copy.
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
		// The documents a video's earlier subtitles were (issue #9), under their new numbers.
		const meta = { ...media.meta };
		if (meta.replaces !== undefined)
			meta.replaces = replacesIn(media.meta).flatMap((old) => result.restored.get(old) ?? []);
		await saveMedia(id, [
			{ name: media.subtitles.name, blob: new Blob([media.subtitles.text]) },
			{ name: 'meta.json', blob: new Blob([JSON.stringify(meta)]) }
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
