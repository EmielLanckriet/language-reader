/**
 * Which build is running, and since when.
 *
 * FR-010 lets the reader decide when to move to a new version, and the reason recorded in the spec
 * for choosing that over automatic adoption was that knowing exactly when a version landed is
 * diagnostic information worth a tap. That only pays off if the information is still available
 * afterwards — a notice that has been dismissed, or missed, is not a record.
 *
 * **Kept out of the database deliberately.** The device-information view has to work when storage
 * is refused, which is exactly the situation someone would open it to understand. Putting the
 * running version in SQLite would make it unreadable in the one case it is most wanted.
 * `localStorage` is the right size of tool here: this is about the application rather than about
 * the reader's data, it is derived and rebuildable, and losing it costs a sentence.
 */

import { version } from '$app/environment';

const KEY = 'language-reader:version-seen';

export interface RunningVersion {
	/** The build identifier, as stamped at build time. */
	id: string;
	/** When this build was first seen on this device, if that could be recorded. */
	since?: Date;
}

/**
 * Read the running version, recording the first sighting of a new one.
 *
 * Every access is guarded: `localStorage` throws outright in some privacy modes rather than
 * returning nothing, and a device-information view that crashed while reporting on a device would
 * be a poor joke.
 */
export function runningVersion(): RunningVersion {
	try {
		const stored = JSON.parse(localStorage.getItem(KEY) ?? 'null') as {
			id?: string;
			at?: string;
		} | null;

		if (stored?.id === version && stored.at) return { id: version, since: new Date(stored.at) };

		const at = new Date();
		localStorage.setItem(KEY, JSON.stringify({ id: version, at: at.toISOString() }));
		return { id: version, since: at };
	} catch {
		// No storage to remember it in. The version itself is still worth reporting.
		return { id: version };
	}
}

/** A build stamp is a timestamp by default, which is not something to show a person raw. */
export function describeVersion(running: RunningVersion): string {
	const asNumber = Number(running.id);
	const built = Number.isFinite(asNumber) && asNumber > 0 ? new Date(asNumber) : undefined;
	return built ? `${built.toLocaleString()} (${running.id})` : running.id;
}
