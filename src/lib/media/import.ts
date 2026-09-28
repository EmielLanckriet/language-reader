/** Turning a bundle from Termux (a tar of media, subtitles and meta.json) into a document. */

import { session } from '$lib/storage/session';
import { fallbackAnalyzer } from '$lib/analyzer/active';
import { resolveTokens, stampOf } from '$lib/analyzer/resolve';
import { RejectedInput } from '$lib/content/types';
import { readTar } from './tar';
import { parseSubtitles } from './subtitles';
import {
	isPlayable,
	isSubtitle,
	saveMedia,
	savePending,
	writePending,
	PENDING_INFO,
	type NamedBlob
} from './store';

/** Simplified before traditional, and a human track (no suffix from yt-dlp) is what arrives first. */
function preference(name: string): number {
	if (/zh-(CN|Hans|SG)\b/i.test(name)) return 0;
	if (/\.zh\./i.test(name)) return 1;
	return 2;
}

/** A document when the bundle carried subtitles; a pending job while Reader transcribes it. */
export type Imported = { documentId: number } | { pending: string };

export async function importBundle(bundle: Blob, fallbackTitle: string): Promise<Imported> {
	const members = await readTar(bundle);
	const named = (name: string) => members.find((member) => member.name === name);
	const subtitles = members
		.filter((member) => isSubtitle(member.name))
		.sort((a, b) => preference(a.name) - preference(b.name));
	const media = members.find((member) => isPlayable(member.name));
	const meta = named('meta.json');
	const keep = [media, meta].filter((member) => member !== undefined);
	const files = (list: typeof keep) =>
		list.map((member) => ({ name: member.name.split('/').pop()!, blob: member.blob }));

	// No subtitles: Reader transcribes the video itself (spec 008). An older Termux's
	// transcribing.json is not kept; its transcript is never waited for.
	if (subtitles.length === 0) {
		if (!media) {
			throw new RejectedInput('This bundle has no Chinese subtitles and no video to transcribe.');
		}
		const job = crypto.randomUUID();
		await savePending(job, files(keep));
		await writePending(job, PENDING_INFO, { importedAt: new Date().toISOString() });
		return { pending: job };
	}

	const title = meta ? titleIn(await meta.blob.text(), fallbackTitle) : fallbackTitle;
	const chosen = subtitles[0];
	const documentId = await createMediaDocument(title, await chosen.blob.text(), [
		...files([chosen]),
		...files(keep)
	]);
	return { documentId };
}

export function titleIn(metaJson: string, fallback: string): string {
	const title = JSON.parse(metaJson).title;
	return typeof title === 'string' ? title : fallback;
}

/** A media document from its subtitles, with the files it came from kept beside it (ADR-0018). */
export async function createMediaDocument(
	title: string,
	subtitles: string,
	files: NamedBlob[]
): Promise<number> {
	const cues = parseSubtitles(subtitles);
	if (cues.length === 0) throw new RejectedInput('The subtitles contain no lines.');
	const rawContent = cues.map((cue) => cue.text).join('\n');
	const { repository } = await session();
	const analyzed = await fallbackAnalyzer.analyze(rawContent);
	const tokens = resolveTokens(rawContent, analyzed, fallbackAnalyzer);
	const id = await repository.saveDocument(
		{ rawContent, contentType: 'text/plain', language: 'zh', title },
		tokens,
		stampOf(fallbackAnalyzer)
	);
	await saveMedia(id, files);
	return id;
}
