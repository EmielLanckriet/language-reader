import { describe, it, expect } from 'vitest';
import {
	next,
	acceptsWrites,
	explain,
	EVENT_KINDS,
	type Availability,
	type Cause
} from '../../src/lib/storage/availability';

// The state machine that decides whether a change from the reader is accepted.
//
// Constitution Principle II's mandatory list does not name this, and plan.md records why it is
// written test-first anyway: the list is a floor, its exemption is for "UI components, wiring, and
// glue code", and a machine deciding whether earned data is kept is none of those.
//
// The reason it is worth this much care is concrete. Slice 0 fell back to an in-memory database
// whenever it could not take the storage lease, and kept working perfectly — accepting documents
// and marks it discarded on the next reload. During slice 1's implementation that turned out to
// happen on an ordinary in-app navigation, not merely with two windows open: the outgoing page's
// worker still held the lease when the incoming page's worker started.

const ANOTHER: Cause = { kind: 'another-copy' };
const BROKEN: Cause = { kind: 'unavailable', reason: 'SecurityError: storage is not available' };
const UNSURE: Cause = { kind: 'unknown', reason: 'InvalidStateError: something else' };

const acquiring = (remembering = false): Availability => ({ kind: 'acquiring', remembering });
const holding: Availability = { kind: 'holding' };
const paused: Availability = { kind: 'paused' };
const refused = (cause: Cause = ANOTHER): Availability => ({ kind: 'refused', cause });

const EVERY_STATE = (): Availability[] => [
	acquiring(),
	acquiring(true),
	holding,
	paused,
	refused()
];

describe('accepting writes', () => {
	it('is true in exactly one state (FR-012, FR-016)', () => {
		// The whole slice in one assertion. Everything else here exists to make sure the machine
		// arrives in the right state; this is what being in it means.
		const accepting = EVERY_STATE().filter(acceptsWrites);
		expect(accepting).toEqual([holding]);
	});
});

describe('yielding the lease when this copy is not the one being looked at', () => {
	it('releases when hidden', () => {
		expect(next(holding, { kind: 'became-hidden' })).toEqual({ state: paused, effect: 'release' });
	});

	it('reacquires when visible again', () => {
		expect(next(paused, { kind: 'became-visible' })).toEqual({
			state: acquiring(false),
			effect: 'acquire'
		});
	});

	it('does nothing when a copy that already holds the lease becomes visible', () => {
		expect(next(holding, { kind: 'became-visible' })).toEqual({ state: holding, effect: 'none' });
	});

	it('releases what it just acquired if it was hidden while acquiring', () => {
		// The acquire was already in flight when the reader left. Holding the lease for a copy
		// nobody is looking at is exactly what this design exists not to do.
		const hidden = next(acquiring(), { kind: 'became-hidden' });
		expect(hidden.state).toEqual(paused);
		expect(next(paused, { kind: 'acquire-succeeded' })).toEqual({
			state: paused,
			effect: 'release'
		});
	});
});

describe('recovering from being unable to save', () => {
	it('is never a state the application gets stuck in', () => {
		// Three different things the reader can do, all of which lead back to trying again. This is
		// the spec's edge case: read-only is a condition of the moment, never a trap.
		for (const event of [
			{ kind: 'became-visible' },
			{ kind: 'reader-attempted-change' },
			{ kind: 'reader-asked-to-retry' }
		] as const) {
			expect(next(refused(), event).state.kind).toBe('acquiring');
			expect(next(refused(), event).effect).toBe('acquire');
		}
	});

	it('remembers the change the reader was making, and only that (FR-015)', () => {
		const attempt = next(refused(), { kind: 'reader-attempted-change' });
		expect(attempt.state).toEqual(acquiring(true));

		// Asking to retry is not itself a change, so there is nothing to carry out afterwards.
		expect(next(refused(), { kind: 'reader-asked-to-retry' }).state).toEqual(acquiring(false));
	});

	it('carries the remembered change out on success, so the reader does not repeat it', () => {
		expect(next(acquiring(true), { kind: 'acquire-succeeded' })).toEqual({
			state: holding,
			effect: 'perform-remembered-change'
		});
	});

	it('carries out nothing when there was nothing to remember', () => {
		expect(next(acquiring(false), { kind: 'acquire-succeeded' })).toEqual({
			state: holding,
			effect: 'none'
		});
	});

	it('forgets the change if the attempt fails (FR-012)', () => {
		// "Nothing is held in the hope that storage becomes available." The memory lasts exactly one
		// attempt, which is what makes the retry honest rather than a queue in disguise.
		const failed = next(acquiring(true), { kind: 'acquire-failed', cause: ANOTHER });
		expect(failed.state).toEqual(refused(ANOTHER));
		expect(next(failed.state, { kind: 'acquire-succeeded' }).effect).not.toBe(
			'perform-remembered-change'
		);
	});

	it('performs a remembered change at most once', () => {
		const held = next(acquiring(true), { kind: 'acquire-succeeded' }).state;
		expect(next(held, { kind: 'acquire-succeeded' }).effect).toBe('none');
	});

	it('does not start a second attempt while one is in flight', () => {
		// Two acquires racing for one exclusive lease is a way to lose to yourself.
		const busy = next(acquiring(false), { kind: 'reader-attempted-change' });
		expect(busy.effect).toBe('none');
		expect(busy.state).toEqual(acquiring(true));
	});
});

describe('the shape of the machine', () => {
	it('always says why it is refusing', () => {
		// A notice that cannot say why is the silent failure this slice exists to remove.
		for (const cause of [ANOTHER, BROKEN, UNSURE]) {
			const state = next(acquiring(), { kind: 'acquire-failed', cause }).state;
			expect(state.kind).toBe('refused');
			expect(state.kind === 'refused' && state.cause).toEqual(cause);
		}
	});

	it('has no event that means "time passed" (FR-015a)', () => {
		// Recovery is driven by the reader doing something, never by a timer. The machine cannot
		// poll, because there is no event it could poll with.
		expect(EVENT_KINDS).not.toContain('tick');
		for (const kind of EVENT_KINDS) {
			expect(kind).not.toMatch(/tick|timer|poll|interval|elapsed/);
		}
	});

	it('leaves the state alone for anything it has no rule for', () => {
		expect(next(refused(), { kind: 'became-hidden' })).toEqual({
			state: refused(),
			effect: 'none'
		});
	});
});

describe('telling the reader what went wrong (FR-013)', () => {
	it('asks for opposite actions for the two causes that call for opposite actions', () => {
		// The point of distinguishing them at all: one is fixed by closing a window, the other is
		// not, and sending someone to hunt for a window that is not open is worse than saying so.
		expect(explain(ANOTHER).action).not.toEqual(explain(BROKEN).action);
	});

	it('names the other copy when that is what it is', () => {
		expect(explain(ANOTHER).action).toMatch(/close/i);
	});

	it('does not blame another copy when storage is simply unavailable', () => {
		expect(explain(BROKEN).action).not.toMatch(/close/i);
		expect(explain(BROKEN).detail).toContain('SecurityError');
	});

	it('admits uncertainty rather than guessing, and shows what it recorded', () => {
		const unsure = explain(UNSURE);
		expect(unsure.headline + ' ' + unsure.action).toMatch(/not sure|cannot tell|unclear|unknown/i);
		expect(unsure.detail).toContain('InvalidStateError');
	});

	it('always gives the reader something to read', () => {
		for (const cause of [ANOTHER, BROKEN, UNSURE]) {
			expect(explain(cause).headline.length).toBeGreaterThan(0);
			expect(explain(cause).action.length).toBeGreaterThan(0);
		}
	});
});
