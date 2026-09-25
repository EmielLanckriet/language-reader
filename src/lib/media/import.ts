/** Turning a bundle from Termux (a tar of media, subtitles and meta.json) into a document. */

import { session } from '$lib/storage/session';
import { fallbackAnalyzer } from '$lib/analyzer/active';
import { resolveTokens, stampOf } from '$lib/analyzer/resolve';
import { RejectedInput } from '$lib/content/types';
import { readTar } from './tar';
import { parseSubtitles } from './subtitles';
import { isPlayable, isSubtitle, saveMedia } from './store';

/** Simplified before traditional, and a human track (no suffix from yt-dlp) is what arrives first. */
function preference(name: string): number {
	if (/zh-(CN|Hans|SG)\b/i.test(name)) return 0;
	if (/\.zh\./i.test(name)) return 1;
	return 2;
}

export async function importBundle(bundle: Blob, fallbackTitle: string): Promise<number> {
	const members = await readTar(bundle);
	const subtitles = members
		.filter((member) => isSubtitle(member.name))
		.sort((a, b) => preference(a.name) - preference(b.name));
	const media = members.find((member) => isPlayable(member.name));
	const metaMember = members.find((member) => member.name === 'meta.json');
	const meta = metaMember ? JSON.parse(await metaMember.blob.text()) : {};

	if (subtitles.length === 0) {
		throw new RejectedInput(
			'This bundle has no Chinese subtitles, so there is nothing to read yet.'
		);
	}
	const chosen = subtitles[0];
	const cues = parseSubtitles(await chosen.blob.text());
	if (cues.length === 0) throw new RejectedInput(`${chosen.name} contains no subtitle lines.`);

	const rawContent = cues.map((cue) => cue.text).join('\n');
	const document = {
		rawContent,
		contentType: 'text/plain',
		language: 'zh',
		title: typeof meta.title === 'string' ? meta.title : fallbackTitle
	};
	const { repository } = await session();
	const analyzed = await fallbackAnalyzer.analyze(rawContent);
	const tokens = resolveTokens(rawContent, analyzed, fallbackAnalyzer);
	const id = await repository.saveDocument(document, tokens, stampOf(fallbackAnalyzer));

	const keep = [chosen, ...(media ? [media] : []), ...(metaMember ? [metaMember] : [])];
	await saveMedia(
		id,
		keep.map((member) => ({ name: member.name.split('/').pop()!, blob: member.blob }))
	);
	return id;
}
