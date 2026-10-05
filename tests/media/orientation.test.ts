import { describe, it, expect } from 'vitest';
import { landscapeWhileFullscreen } from '../../src/lib/media/orientation';

/** A document whose full screen the test turns on and off, as the button or the back gesture would. */
function fakeScreen() {
	const listeners = new Set<() => void>();
	const calls: string[] = [];
	const doc = {
		fullscreenElement: null as object | null,
		addEventListener: (_: 'fullscreenchange', f: () => void) => listeners.add(f),
		removeEventListener: (_: 'fullscreenchange', f: () => void) => listeners.delete(f),
		exitFullscreen: async () => {
			calls.push('exit');
			set(false);
		}
	};
	const orientation = {
		lock: async (o: string) => void calls.push(`lock ${o}`),
		unlock: () => void calls.push('unlock')
	};
	function set(on: boolean) {
		doc.fullscreenElement = on ? {} : null;
		for (const f of listeners) f();
	}
	return { doc, orientation, calls, set };
}

describe('landscape only while full screen', () => {
	it('unlocks the rotation when full screen ends without the button (back gesture)', () => {
		const { doc, orientation, calls, set } = fakeScreen();
		landscapeWhileFullscreen(doc, orientation);
		set(true);
		void orientation.lock('landscape');
		set(false);
		expect(calls).toEqual(['lock landscape', 'unlock']);
	});

	it('leaves full screen and unlocks when the player goes away while full screen', () => {
		const { doc, orientation, calls, set } = fakeScreen();
		const stop = landscapeWhileFullscreen(doc, orientation);
		set(true);
		stop();
		expect(doc.fullscreenElement).toBeNull();
		expect(calls).toContain('exit');
		expect(calls.at(-1)).toBe('unlock');
	});
});
