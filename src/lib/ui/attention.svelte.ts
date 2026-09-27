/**
 * The attention question waiting to be asked (spec 007, FR-006).
 *
 * Asked by the layout over whatever page comes next, rather than by holding the reader on the page
 * they are leaving: any way out counts (a link, a tab, Android's back gesture), and nothing is
 * blocked. The answer goes to the session that just ended.
 */

import type { Recorder } from './recorder';

/** Below this much reading or playback, the question is not worth the interruption. */
export const ASK_AFTER_MS = 30_000;

let pending = $state<Recorder | null>(null);

export const attention = {
	get pending(): Recorder | null {
		return pending;
	},
	/** A session ended: ask about it if it lasted long enough. */
	ended(recorder: Recorder): void {
		if (recorder.engagedMs() >= ASK_AFTER_MS) pending = recorder;
	},
	answered(): Recorder | null {
		const recorder = pending;
		pending = null;
		return recorder;
	}
};
