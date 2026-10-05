/**
 * Full screen locks the phone to landscape; the lock outlives full screen unless it is undone, and
 * the app then stays sideways (issue #4). Full screen ends by the button, the back gesture, or the
 * player going away, so the unlock follows `fullscreenchange` rather than the button.
 */

interface FullscreenDocument {
	fullscreenElement: unknown;
	addEventListener(type: 'fullscreenchange', listener: () => void): void;
	removeEventListener(type: 'fullscreenchange', listener: () => void): void;
	exitFullscreen(): Promise<void>;
}

interface Rotation {
	unlock?: () => void;
}

/** Unlocks whenever full screen ends; the returned stop also leaves full screen, for unmounting. */
export function landscapeWhileFullscreen(doc: FullscreenDocument, rotation: Rotation): () => void {
	const unlock = () => {
		try {
			rotation.unlock?.();
		} catch {
			// Unsupported (desktop, iPhone): nothing was locked.
		}
	};
	const change = () => {
		if (!doc.fullscreenElement) unlock();
	};
	doc.addEventListener('fullscreenchange', change);
	return () => {
		doc.removeEventListener('fullscreenchange', change);
		if (doc.fullscreenElement) void doc.exitFullscreen().catch(() => {});
		unlock();
	};
}
