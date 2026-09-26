import { describe, it, expect } from 'vitest';
import { serviceChange } from '../../src/lib/media/service';

// Diagnostics should say once that the service is gone, and once that it restarted, including a
// restart that happened while Reader was closed (a new start time). Nothing on a steady run.

describe('noting the reader service', () => {
	it('notes a stop once, a restart once, and nothing while it keeps running', () => {
		const up1 = { started: '2026-09-27T08:00:00Z' };
		const up2 = { started: '2026-09-27T09:30:00Z' };
		const notes: (string | undefined)[] = [];
		let seen = {};
		for (const [now, at] of [
			[up1, '08:05'],
			[up1, '08:10'],
			[null, '08:20'],
			[null, '08:25'],
			[up2, '09:31'],
			[up2, '09:40']
		] as const) {
			const change = serviceChange(seen, now, at);
			seen = change.seen;
			notes.push(change.note);
		}
		expect(notes).toEqual([
			undefined,
			undefined,
			"Termux's reader service isn't running (last seen running 08:10).",
			undefined,
			"Termux's reader service restarted at 2026-09-27T09:30:00Z (last seen running 08:10).",
			undefined
		]);
	});

	it('notes a restart it never saw go down', () => {
		const change = serviceChange(
			{ started: '2026-09-27T08:00:00Z', lastUp: '08:10' },
			{ started: '2026-09-27T09:30:00Z' },
			'09:31'
		);
		expect(change.note).toMatch(/restarted at 2026-09-27T09:30:00Z/);
	});
});
