/**
 * Which of a media document's files a copy carries: its subtitles, its metadata, and the
 * downloaded tracks with the English the reader chose among them (spec 012). The video is found
 * again through Termux; machine and quick English are made again. Pure.
 */

import { ENGLISH_SETTING, TRACKS, isSubtitle, isTrack } from '$lib/media/store';
import type { CopyDocument } from './format';

export interface TextFile {
	name: string;
	text: string;
}

/** Besides the subtitles and meta.json; copies before 2026-11-07 left these out, and a restore lost them. */
function besides(name: string): boolean {
	return name === TRACKS || name === ENGLISH_SETTING || isTrack(name);
}

export function carried(name: string): boolean {
	return isSubtitle(name) || name === 'meta.json' || besides(name);
}

export function mediaOf(files: readonly TextFile[]): CopyDocument['media'] {
	const subtitles = files.find((file) => isSubtitle(file.name));
	if (!subtitles) return undefined;
	const meta = files.find((file) => file.name === 'meta.json');
	const more = files.filter((file) => besides(file.name));
	return {
		subtitles: { name: subtitles.name, text: subtitles.text },
		meta: meta ? JSON.parse(meta.text) : {},
		...(more.length > 0 ? { files: more.map(({ name, text }) => ({ name, text })) } : {})
	};
}

/** What a restore writes into the document's folder. */
export function filesOf(media: NonNullable<CopyDocument['media']>): TextFile[] {
	return [
		media.subtitles,
		{ name: 'meta.json', text: JSON.stringify(media.meta) },
		...(media.files ?? [])
	];
}

/** What tells a document's carried files from the ones last sent, without reading them. */
export function markOf(files: readonly { name: string; size: number; lastModified: number }[]) {
	return files
		.filter((file) => carried(file.name))
		.map((file) => `${file.name}:${file.size}:${file.lastModified}`)
		.sort();
}
