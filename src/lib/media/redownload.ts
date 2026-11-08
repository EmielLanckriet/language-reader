/**
 * Downloading a video again (2026-11-08), for a document that kept its subtitles, and perhaps its
 * sound, but lost its video: the 2026-11-04 wipe, or a restore when Termux no longer had the bundle.
 * Termux downloads it as it does any share; the video then goes into the document's own folder, so
 * its text, line edits and history stay as they are. While Termux works, `redownload` in meta.json
 * marks the document as waiting, and the download is not offered under New from Termux.
 */

import { SERVICE } from './service-address';
import { readTar } from './tar';
import { isPlayable, readMediaJson, saveMedia, writeMediaJson } from './store';
import { downloadState, type TermuxJob } from './termux';

type Meta = Record<string, unknown>;

/** The address Termux downloads from; none for what did not come from YouTube (a spoken story). */
export function videoAddress(meta: Meta): string | undefined {
	const page = meta.webpage_url;
	if (
		typeof page === 'string' &&
		/^https:\/\/(www\.youtube\.com\/watch\?v=|youtu\.be\/)/.test(page)
	)
		return page;
	return typeof meta.id === 'string' && /^[\w-]{6,}$/.test(meta.id)
		? `https://www.youtube.com/watch?v=${meta.id}`
		: undefined;
}

export function waitingForVideo(meta: Meta): boolean {
	return typeof meta.redownload === 'string';
}

/** A video file, as against the sound alone. */
export function isVideo(file: File | undefined): boolean {
	return !!file && /\.(mp4|webm)$/i.test(file.name);
}

/** Asks Termux to download the video again; throws what to tell the reader when it cannot. */
export async function askForVideo(documentId: number): Promise<void> {
	const meta = (await readMediaJson<Meta>(documentId, 'meta.json')) ?? {};
	const url = videoAddress(meta);
	if (!url) throw new Error('This document has no YouTube address to download its video from.');
	let response: Response;
	try {
		response = await fetch(`${SERVICE}/download`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ url })
		});
	} catch {
		throw new Error('Termux is not reachable. Start it, then try again.');
	}
	if (!response.ok) throw new Error(`Termux did not take the download (${response.status}).`);
	await writeMediaJson(documentId, 'meta.json', { ...meta, redownload: new Date().toISOString() });
}

/**
 * Where Termux is with it: a download in progress (by title: the id arrives with the bundle), one
 * that failed, or nothing to show yet. 'unreachable' when the service is not running.
 */
export async function videoProgress(
	meta: Meta
): Promise<{ label: string; fraction?: number; failed?: boolean } | 'unreachable' | undefined> {
	let jobs: (TermuxJob & { id?: string | null })[];
	try {
		const response = await fetch(`${SERVICE}/downloads`, { cache: 'no-store' });
		if (!response.ok) return 'unreachable';
		jobs = await response.json();
	} catch {
		return 'unreachable';
	}
	const job = jobs.find((job) => !job.ready && job.title === meta.title);
	if (!job?.progress) return undefined;
	if (job.progress.stage === 'failed')
		return { label: job.progress.reason ?? 'The download failed.', failed: true };
	return downloadState(job);
}

/**
 * Puts the video into the document's folder once Termux has its bundle, newest first. True when
 * it did; the sound already kept stays as the sound for cards and a locked screen.
 */
export async function takeVideo(documentId: number): Promise<boolean> {
	const meta = (await readMediaJson<Meta>(documentId, 'meta.json')) ?? {};
	if (typeof meta.id !== 'string' || !meta.id) return false;
	const found = await fetch(`${SERVICE}/media/${encodeURIComponent(meta.id)}`, {
		cache: 'no-store'
	});
	if (!found.ok) return false;
	const job: string = (await found.json()).job;
	const bundle = await fetch(`${SERVICE}/downloads/${encodeURIComponent(job)}/bundle.tar`);
	if (!bundle.ok) return false;
	const video = (await readTar(await bundle.blob())).find(
		(member) => isPlayable(member.name) && /\.(mp4|webm)$/i.test(member.name)
	);
	if (!video) return false;
	await saveMedia(documentId, [{ name: video.name.split('/').pop()!, blob: video.blob }]);
	// The new job is this document's from now on: not offered as new, and its translation followed.
	const rest: Meta = { ...meta, job };
	delete rest.redownload;
	await writeMediaJson(documentId, 'meta.json', rest);
	return true;
}
