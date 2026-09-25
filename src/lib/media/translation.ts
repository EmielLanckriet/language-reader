/**
 * Following a translation that Termux is still writing (scripts/termux/translate.py), through the
 * reader service. English is derived: when it is complete it is kept beside the video, and until
 * then it is simply shown as it arrives.
 */

import { parseSubtitles } from './subtitles';

const SERVICE = 'http://127.0.0.1:8765';
const POLL_MS = 3000;

export function followTranslation(
	job: string,
	update: (lines: string[], done: boolean, vtt: string) => void
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
				update(
					parseSubtitles(vtt).map((cue) => cue.text),
					done,
					vtt
				);
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
