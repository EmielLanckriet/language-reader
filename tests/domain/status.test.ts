import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
	activation,
	replayStatuses,
	validateStatusChange,
	ACTIVE_AT_DAYS,
	type ActivationInput,
	type ReadingPoint,
	type StatusChange
} from '../../src/lib/domain/status';

// Spec 019 (ADR-0044): a word's status, kept apart from its memory, and the one rule that makes a
// retired word active.

const pos = (deviceSeq: number, deviceId = 'd') => ({ deviceId, deviceSeq });
const change = (
	lexemeId: number,
	deviceSeq: number,
	status: StatusChange['status'],
	cause: StatusChange['cause'] = 'reader'
): StatusChange => ({ lexemeId, status, cause, at: '2026-10-20T08:00:00Z', ...pos(deviceSeq) });
const point = (deviceSeq: number, stability: number, cardReview = false): ReadingPoint => ({
	...pos(deviceSeq),
	stability,
	cardReview
});
const SWITCH = pos(100);
const input = (parts: Partial<ActivationInput>): ActivationInput => ({
	status: 'retired',
	switchAt: SWITCH,
	trajectory: [],
	...parts
});

describe('status replay', () => {
	it('is the latest change per word in history order, whatever order they arrive in', () => {
		const replayed = replayStatuses([
			change(1, 7, 'retired'),
			change(1, 5, 'active', 'stable'),
			change(2, 3, 'ignored'),
			change(1, 6, 'ignored')
		]);
		expect(Object.fromEntries([...replayed].map(([id, c]) => [id, c.status]))).toEqual({
			1: 'retired',
			2: 'ignored'
		});
	});

	it('orders by device first, then by its sequence', () => {
		const replayed = replayStatuses([
			{ ...change(1, 9, 'active', 'stable'), deviceId: 'a' },
			{ ...change(1, 1, 'ignored'), deviceId: 'b' }
		]);
		expect(replayed.get(1)!.status).toBe('ignored');
	});

	it('has nothing for a word without changes', () => {
		expect(replayStatuses([change(1, 1, 'active', 'stable')]).has(2)).toBe(false);
	});
});

describe('a status change', () => {
	it('is refused with a status or cause it does not know', () => {
		expect(() =>
			validateStatusChange({ ...change(1, 1, 'retired'), status: 'known' as never })
		).toThrow();
		expect(() =>
			validateStatusChange({ ...change(1, 1, 'retired'), cause: 'sweep' as never })
		).toThrow();
	});

	it('is refused when the rule makes anything but an active word', () => {
		expect(() => validateStatusChange(change(1, 1, 'retired', 'stable'))).toThrow();
		expect(() => validateStatusChange(change(1, 1, 'ignored', 'first-review'))).toThrow();
		expect(() => validateStatusChange(change(1, 1, 'retired', 'carried-over'))).toThrow();
	});

	it('is accepted for every edge the reader and the rule may take', () => {
		for (const ok of [
			change(1, 1, 'retired'),
			change(1, 1, 'ignored'),
			change(1, 1, 'active'),
			change(1, 1, 'active', 'stable'),
			change(1, 1, 'active', 'first-review'),
			change(1, 1, 'active', 'carried-over')
		])
			expect(() => validateStatusChange(ok)).not.toThrow();
	});
});

describe('becoming active by stability', () => {
	it('happens at 14 days, not just under', () => {
		expect(ACTIVE_AT_DAYS).toBe(14);
		expect(activation(input({ trajectory: [point(101, 13.9)] }))).toBeUndefined();
		expect(activation(input({ trajectory: [point(101, 13.9), point(102, 14)] }))).toBe('stable');
	});

	it('counts any point of the history, before the switch and an Anki seed included', () => {
		expect(activation(input({ trajectory: [point(1, 30), point(2, 3)] }))).toBe('stable');
	});

	it('after a hand retire past 14 days, waits for a dip under 14 and a rise back', () => {
		const retiredByReader = pos(110);
		const before = [point(1, 200)];
		expect(
			activation(input({ retiredByReader, trajectory: [...before, point(111, 250)] }))
		).toBeUndefined();
		expect(
			activation(
				input({ retiredByReader, trajectory: [...before, point(111, 250), point(112, 2)] })
			)
		).toBeUndefined();
		expect(
			activation(
				input({
					retiredByReader,
					trajectory: [...before, point(111, 250), point(112, 2), point(113, 15)]
				})
			)
		).toBe('stable');
	});

	it('after a hand retire under 14 days, happens at the next 14', () => {
		const retiredByReader = pos(110);
		expect(activation(input({ retiredByReader, trajectory: [point(1, 5), point(111, 16)] }))).toBe(
			'stable'
		);
	});

	it('after a hand retire, ignores what came before it', () => {
		expect(
			activation(input({ retiredByReader: pos(110), trajectory: [point(1, 5), point(2, 30)] }))
		).toBeUndefined();
	});
});

describe('becoming active by a first review on Cards', () => {
	it('happens for a Cards review after the latest change and after the switch', () => {
		expect(activation(input({ lastChange: pos(105), trajectory: [point(106, 2, true)] }))).toBe(
			'first-review'
		);
	});

	it('does not for a review before the switch, or before the latest change', () => {
		expect(activation(input({ trajectory: [point(99, 2, true)] }))).toBeUndefined();
		expect(
			activation(input({ lastChange: pos(105), trajectory: [point(104, 2, true)] }))
		).toBeUndefined();
	});

	it('does not for a drill grade', () => {
		expect(activation(input({ trajectory: [point(106, 2, false)] }))).toBeUndefined();
	});
});

describe('words the rule never moves', () => {
	it('leaves active and ignored words alone, whatever their history', () => {
		const anyPoint = fc.record({
			deviceSeq: fc.integer({ min: 0, max: 300 }),
			stability: fc.double({ min: 0.001, max: 400, noNaN: true }),
			cardReview: fc.boolean()
		});
		fc.assert(
			fc.property(
				fc.constantFrom('active' as const, 'ignored' as const),
				fc.array(anyPoint, { size: 'max', maxLength: 30 }),
				(status, points) => {
					const trajectory = points.map((p) => point(p.deviceSeq, p.stability, p.cardReview));
					expect(activation(input({ status, trajectory }))).toBeUndefined();
				}
			)
		);
	});
});
