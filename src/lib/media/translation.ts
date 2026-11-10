/**
 * Following a translation that Termux is still writing (scripts/termux/translate.py), through the
 * reader service. English is derived: when it is complete it is kept beside the video, and until
 * then it is simply shown as it arrives.
 */

import { parseSubtitles, type Cue } from './subtitles';
import type { StoredMedia } from './store';
import { humanByLine } from '$lib/translation/lines';
import { RECUT_VERSION } from '$lib/translation/recut';

import { SERVICE } from '$lib/media/service-address';
const POLL_MS = 3000;

export function followTranslation(
	job: string,
	update: (cues: Cue[], done: boolean, vtt: string) => void
): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const base = `${SERVICE}/downloads/${encodeURIComponent(job)}`;

	async function poll() {
		try {
			const status = await fetch(`${base}/translate.json`, { cache: 'no-store' });
			if (status.ok) {
				const { done } = await status.json();
				const vtt = await (await fetch(`${base}/media.en.vtt`, { cache: 'no-store' })).text();
				update(parseSubtitles(vtt), done, vtt);
				if (done) return;
			}
		} catch {
			// Termux is not reachable just now; the safeguard notice already says so.
		}
		if (!stopped) timer = setTimeout(() => void poll(), POLL_MS);
	}

	void poll();
	return () => {
		stopped = true;
		clearTimeout(timer);
	};
}

/** The job a document's video came from, recorded in its meta.json by termux-url-opener. */
export function jobOf(meta: Record<string, unknown>): string | undefined {
	return typeof meta.job === 'string' ? meta.job : undefined;
}

/** The chosen track's English as matched to the lines by time, before it is re-cut. */
export function trackLines(
	media: Pick<StoredMedia, 'cues' | 'tracks' | 'english'>
): (string | undefined)[] | undefined {
	const setting = media.english;
	if (setting.source !== 'track') return undefined;
	const track = media.tracks.find((t) => t.file === setting.file);
	return track
		? humanByLine(media.cues, parseSubtitles(track.text, { keepRepeats: true }))
		: undefined;
}

/** Whether the chosen track's re-cut English is kept and current. */
export function recutCurrent(media: Pick<StoredMedia, 'english' | 'recut'>): boolean {
	const { english, recut } = media;
	return (
		english.source === 'track' && recut?.track === english.file && recut.version === RECUT_VERSION
	);
}

/**
 * The human English of a media document, one entry per Chinese line (spec 012): the track the
 * reader chose, re-cut over the lines (translation/recut.ts) once that is made, matched by time
 * until then; empty when the document shows machine English or none.
 */
export function humanLines(
	media: Pick<StoredMedia, 'cues' | 'tracks' | 'english' | 'recut'>
): (string | undefined)[] {
	if (recutCurrent(media)) return media.recut!.lines.map((line) => line ?? undefined);
	return trackLines(media) ?? [];
}
