/** Turning a bundle from Termux (a tar of media, subtitles and meta.json) into a document. */

import { session } from '$lib/storage/session';
import { fallbackAnalyzer } from '$lib/analyzer/active';
import { resolveTokens, stampOf } from '$lib/analyzer/resolve';
import { RejectedInput } from '$lib/content/types';
import { readTar } from './tar';
import {
	classifyTracks,
	choiceNeeded,
	defaultChoice,
	parseSubtitles,
	type ClassifiedTrack,
	type SubtitleTrack
} from './subtitles';
import {
	ENGLISH_SETTING,
	isPicture,
	isPlayable,
	isSubtitle,
	isTrack,
	THUMBNAIL,
	TRACKS,
	saveMedia,
	savePending,
	writePending,
	PENDING_INFO,
	type EnglishSetting,
	type NamedBlob
} from './store';

/** A document when the bundle carried subtitles; a pending job while Reader transcribes it. */
export type Imported = { documentId: number } | { pending: string };

/** The reader's answer to the track choice (spec 012): a track file, or the alternatives. */
export interface TrackChoice {
	chinese: string | 'transcribe';
	english: string | 'machine' | 'none';
}

/** What a bundle offers, and whether to ask before importing it. */
export interface ImportPlan {
	tracks: ClassifiedTrack[];
	defaults: TrackChoice;
	needed: boolean;
}

type Member = Awaited<ReturnType<typeof readTar>>[number];

/**
 * The subtitle tracks in a bundle. From 012 on they are track.<lang>.vtt files described by
 * tracks.json; an older bundle's media.<lang>.vtt files count as human tracks without names.
 */
async function tracksIn(members: Member[]): Promise<SubtitleTrack[]> {
	const base = (name: string) => name.split('/').pop()!;
	const manifest = members.find((member) => base(member.name) === TRACKS);
	if (manifest) {
		const described: Omit<SubtitleTrack, 'text'>[] = JSON.parse(await manifest.blob.text());
		const found = await Promise.all(
			described.map(async (track) => {
				const member = members.find((m) => base(m.name) === track.file && isTrack(track.file));
				return member ? { ...track, text: await member.blob.text() } : undefined;
			})
		);
		return found.filter((track) => track !== undefined);
	}
	return Promise.all(
		members
			.filter((member) => isSubtitle(base(member.name)))
			.map(async (member) => ({
				file: base(member.name),
				lang: /\.([^.]+)\.(vtt|srt)$/i.exec(member.name)?.[1] ?? '',
				name: '',
				kind: 'human' as const,
				text: await member.blob.text()
			}))
	);
}

export async function planImport(bundle: Blob): Promise<ImportPlan> {
	const tracks = classifyTracks(await tracksIn(await readTar(bundle)));
	const { chinese, english } = defaultChoice(tracks);
	return {
		tracks,
		defaults: { chinese: chinese ?? 'transcribe', english },
		needed: choiceNeeded(tracks)
	};
}

function englishSetting(english: TrackChoice['english']): EnglishSetting {
	if (english === 'machine' || english === 'none') return { source: english };
	return { source: 'track', file: english };
}

/** The document's own name for its Chinese track: what every reader of `cues` already expects. */
function chineseName(track: SubtitleTrack): string {
	return isTrack(track.file) ? `media.${track.lang || 'zh'}.vtt` : track.file;
}

/**
 * A bundle as a document, with the reader's choice or the defaults. Every downloaded track is kept
 * beside it with tracks.json (FR-008), so a later English switch or re-import needs no download.
 */
export async function importBundle(
	bundle: Blob,
	fallbackTitle: string,
	choice?: TrackChoice
): Promise<Imported> {
	const members = await readTar(bundle);
	const named = (name: string) => members.find((member) => member.name === name);
	const plan = await planImport(bundle);
	const chosen = choice ?? plan.defaults;
	const media = members.find((member) => isPlayable(member.name));
	const meta = named('meta.json');
	// YouTube's picture, when Termux saved one: kept as the library's thumbnail (store.ts).
	const picture = members.find((member) => isPicture(member.name));
	const keep = [media, meta].filter((member) => member !== undefined);
	const files = (list: typeof keep) =>
		list.map((member) => ({ name: member.name.split('/').pop()!, blob: member.blob }));
	const thumbnail = picture ? [{ name: THUMBNAIL, blob: picture.blob }] : [];
	const kept: NamedBlob[] = plan.tracks
		.filter((track) => isTrack(track.file))
		.map((track) => ({ name: track.file, blob: new Blob([track.text], { type: 'text/vtt' }) }));
	if (kept.length > 0) {
		const manifest = plan.tracks.map(({ file, lang, name, kind }) => ({ file, lang, name, kind }));
		kept.push({ name: TRACKS, blob: new Blob([JSON.stringify(manifest)]) });
	}
	kept.push({
		name: ENGLISH_SETTING,
		blob: new Blob([JSON.stringify(englishSetting(chosen.english))])
	});

	const track = plan.tracks.find((t) => t.file === chosen.chinese && t.chinese);
	// No Chinese track, or the reader asked for it: Reader transcribes the video itself (spec 008).
	// An older Termux's transcribing.json is not kept; its transcript is never waited for.
	if (!track) {
		if (!media) {
			throw new RejectedInput('This bundle has no Chinese subtitles and no video to transcribe.');
		}
		const job = crypto.randomUUID();
		await savePending(job, [...files(keep), ...thumbnail, ...kept]);
		await writePending(job, PENDING_INFO, { importedAt: new Date().toISOString() });
		return { pending: job };
	}

	const title = meta ? titleIn(await meta.blob.text(), fallbackTitle) : fallbackTitle;
	const documentId = await createMediaDocument(title, track.text, [
		{ name: chineseName(track), blob: new Blob([track.text], { type: 'text/vtt' }) },
		...files(keep),
		...thumbnail,
		...kept
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
