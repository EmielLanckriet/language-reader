/**
 * New videos, fetched from Termux rather than handed over by the share sheet (ADR-0022): Chrome
 * could not read a file Termux shared, and Samsung Internet's installed app is no share target.
 */

import { importBundle, type Imported, type TrackChoice } from './import';
import { awaitedVideos, importedJobs } from './store';

import { SERVICE } from '$lib/media/service-address';
import { NATIVE } from '$lib/native';
import { files, takeBundle } from './files';
import { readTar, type Bundle } from './tar';

export interface TermuxJob {
	job: string;
	title: string;
	/** The YouTube id, once the bundle exists. */
	id?: string | null;
	bytes: number;
	/** False while Termux is still downloading; absent from services older than this field. */
	ready?: boolean;
	progress?: {
		/** speaking and waiting: a spoken story (spec 018), made by speak.py rather than downloaded. */
		stage: 'starting' | 'downloading' | 'packing' | 'failed' | 'speaking' | 'waiting';
		part?: 'video' | 'audio';
		percent?: number;
		/** A failed download's cause: yt-dlp's last ERROR line (issue #28). */
		reason?: string;
	};
}

/** What to show for a download still in progress, and how far it is (0–1, or undefined). */
export function downloadState(job: TermuxJob): { label: string; fraction?: number } {
	const progress = job.progress;
	if (progress?.stage === 'downloading' && progress.percent !== undefined)
		return {
			label: `Downloading the ${progress.part ?? 'video'}…`,
			fraction: progress.percent / 100
		};
	if (progress?.stage === 'packing') return { label: 'Almost ready…' };
	if (progress?.stage === 'speaking')
		return { label: 'Speaking the story…', fraction: (progress.percent ?? 0) / 100 };
	if (progress?.stage === 'waiting') return { label: 'Waiting for the phone’s model…' };
	return { label: 'Starting the download…' };
}

/** Downloads not yet in the library, newest first; 'unreachable' when the service is not running. */
export async function newFromTermux(): Promise<TermuxJob[] | 'unreachable'> {
	let listed: TermuxJob[];
	try {
		const response = await fetch(`${SERVICE}/downloads`, { cache: 'no-store' });
		if (!response.ok) return 'unreachable';
		listed = await response.json();
	} catch {
		return 'unreachable';
	}
	const imported = await importedJobs();
	// A video a document asked for again goes into that document, not into the library as new.
	const awaited = await awaitedVideos();
	return listed.filter(
		(job) =>
			!imported.has(job.job) && !(job.id ? awaited.ids.has(job.id) : awaited.titles.has(job.title))
	);
}

/**
 * A Termux job's bundle, or null when Termux does not have it. Natively the shell downloads and
 * unpacks it into its own files (files.ts): a video never crosses into the page. Call
 * `releaseBundle` when done with it.
 */
export async function bundleFromTermux(job: string): Promise<Bundle | null> {
	const url = `${SERVICE}/downloads/${encodeURIComponent(job)}/bundle.tar`;
	if (NATIVE) {
		try {
			return (await takeBundle(url, job)).map((file) => ({
				name: file.name,
				size: file.size,
				blob: file
			}));
		} catch (error) {
			if (/answered HTTP\/\S+ 404/.test(String(error))) return null;
			throw error;
		}
	}
	const response = await fetch(url);
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Termux answered ${response.status}.`);
	return readTar(await response.blob());
}

/** Natively, the unpacked bundle's folder goes once its files are taken (they are linked). */
export async function releaseBundle(job: string): Promise<void> {
	if (NATIVE) await files.remove(['staging', job]).catch(() => {});
}

export async function fetchBundle(job: TermuxJob): Promise<Bundle> {
	try {
		const bundle = await bundleFromTermux(job.job);
		if (bundle) return bundle;
		throw new Error('it is gone');
	} catch (error) {
		throw new Error(`Termux could not hand over "${job.title}" (${(error as Error).message}).`);
	}
}

export async function importJob(
	job: TermuxJob,
	bundle?: Bundle,
	choice?: TrackChoice
): Promise<Imported> {
	try {
		return await importBundle(bundle ?? (await fetchBundle(job)), job.title, choice);
	} finally {
		await releaseBundle(job.job);
	}
}

/**
 * Tells Termux what the reader chose (spec 012, contracts/bundle-and-service.md), so it translates
 * the track that is read and only the lines the chosen English leaves uncovered. Termux translates
 * nothing for such a job until this arrives.
 */
export async function reportChoice(job: string, choice: TrackChoice): Promise<void> {
	const response = await fetch(`${SERVICE}/downloads/${encodeURIComponent(job)}/choice.json`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(choice)
	});
	if (!response.ok)
		throw new Error(`Termux did not take the subtitle choice (${response.status}).`);
}
