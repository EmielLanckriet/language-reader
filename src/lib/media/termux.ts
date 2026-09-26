/**
 * New videos, fetched from Termux rather than handed over by the share sheet (ADR-0022): Chrome
 * could not read a file Termux shared, and Samsung Internet's installed app is no share target.
 */

import { importBundle, type Imported } from './import';
import { importedJobs } from './store';

const SERVICE = 'http://127.0.0.1:8765';

export interface TermuxJob {
	job: string;
	title: string;
	bytes: number;
	transcribing: boolean;
	/** False while Termux is still downloading; absent from services older than this field. */
	ready?: boolean;
	progress?: {
		stage: 'starting' | 'downloading' | 'packing';
		part?: 'video' | 'audio';
		percent?: number;
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
	return listed.filter((job) => !imported.has(job.job));
}

export async function importJob(job: TermuxJob): Promise<Imported> {
	const response = await fetch(`${SERVICE}/downloads/${encodeURIComponent(job.job)}/bundle.tar`);
	if (!response.ok)
		throw new Error(`Termux could not hand over "${job.title}" (${response.status}).`);
	return importBundle(await response.blob(), job.title);
}
