/**
 * Whether this copy of the application may accept a change from the reader.
 *
 * Slice 0 opened an in-memory database whenever it could not take the storage lease, and then
 * carried on perfectly: it accepted documents and marks, showed them, and lost them on the next
 * reload. That is the failure this module exists to make impossible, and it turned out to be much
 * easier to hit than the specification assumed. It does not need two windows. During slice 1's
 * implementation it was reproduced by an ordinary in-app navigation — the outgoing page's storage
 * worker still held the lease when the incoming page's worker started, so the new page fell back to
 * memory, showed an empty library, and accepted a save it threw away.
 *
 * The answer has two halves, and this file is the first: a copy holds the lease only while it is
 * the one being looked at, and a copy that does not hold it accepts nothing at all. The second half
 * is that a copy which cannot get the lease keeps asking, whenever the reader does something,
 * rather than giving up and inventing somewhere to put the data.
 *
 * **This module imports nothing.** It is the whole of the decision, expressed as a function from a
 * state and an event to a new state and one thing to do. Everything that touches a browser lives in
 * lease.ts and worker.ts, so that this can be tested without one.
 */

/** Why a copy could not reach durable storage. FR-013 turns on telling the first two apart. */
export type Cause =
	| { kind: 'another-copy' }
	| { kind: 'unavailable'; reason: string }
	| { kind: 'unknown'; reason: string };

export type Availability =
	/** An attempt is in flight. `remembering` is a change waiting on it, from FR-015. */
	| { kind: 'acquiring'; remembering: boolean }
	/** The lease is held and the database is open. The only state that accepts writes. */
	| { kind: 'holding' }
	/** Released deliberately, because nobody is looking at this copy. */
	| { kind: 'paused' }
	/** An attempt was made and failed. Read-only, and able to say why. */
	| { kind: 'refused'; cause: Cause };

export type Event =
	| { kind: 'became-visible' }
	| { kind: 'became-hidden' }
	| { kind: 'reader-attempted-change' }
	| { kind: 'reader-asked-to-retry' }
	| { kind: 'acquire-succeeded' }
	| { kind: 'acquire-failed'; cause: Cause };

/**
 * Every event there is.
 *
 * Exported so a test can assert what is *not* in it: nothing here means "time passed". FR-015a
 * requires that recovery be driven by the reader doing something rather than by a timer, and the
 * cleanest way to guarantee that is for the machine to have no event it could poll with.
 */
export const EVENT_KINDS = [
	'became-visible',
	'became-hidden',
	'reader-attempted-change',
	'reader-asked-to-retry',
	'acquire-succeeded',
	'acquire-failed'
] as const;

/** The one thing the caller must do to reach the new state. */
export type Effect = 'none' | 'acquire' | 'release' | 'perform-remembered-change';

export interface Step {
	state: Availability;
	effect: Effect;
}

/** True in exactly one state. This is FR-012 and FR-016 said once. */
export function acceptsWrites(state: Availability): boolean {
	return state.kind === 'holding';
}

export function next(state: Availability, event: Event): Step {
	switch (event.kind) {
		case 'became-hidden':
			// Nothing is looking at this copy, so it has no business holding the only lease. A
			// release is asked for even mid-acquire: the worker sequences them, and the alternative
			// is a copy nobody can see keeping the copy the reader is looking at from working.
			if (state.kind === 'holding' || state.kind === 'acquiring') {
				return { state: { kind: 'paused' }, effect: 'release' };
			}
			return { state, effect: 'none' };

		case 'became-visible':
			// From `refused` too. The reader switching to this copy is a reason to try again, and
			// is usually the very thing that has just made the lease available.
			if (state.kind === 'holding') return { state, effect: 'none' };
			return attempt(state, false);

		case 'reader-attempted-change':
			// The check happens inside the action, so the change is either performed or refused
			// immediately, and the reader is not asked to do it twice.
			if (state.kind === 'holding') return { state, effect: 'none' };
			return attempt(state, true);

		case 'reader-asked-to-retry':
			// Asking is not itself a change, so there is nothing to carry out afterwards.
			if (state.kind === 'holding') return { state, effect: 'none' };
			return attempt(state, false);

		case 'acquire-succeeded':
			if (state.kind === 'acquiring') {
				return {
					state: { kind: 'holding' },
					effect: state.remembering ? 'perform-remembered-change' : 'none'
				};
			}
			// Acquired after the reader had already left. Give it straight back rather than hold a
			// lease for a copy nobody can see.
			if (state.kind === 'paused') return { state, effect: 'release' };
			return { state, effect: 'none' };

		case 'acquire-failed':
			// The remembered change is dropped here, and that is deliberate. FR-012 forbids holding
			// anything in the hope that storage becomes available; a memory that outlived its
			// attempt would be a write queue wearing a disguise.
			if (state.kind === 'acquiring') {
				return { state: { kind: 'refused', cause: event.cause }, effect: 'none' };
			}
			return { state, effect: 'none' };
	}
}

/**
 * Start an attempt, or note that a change is waiting on one already running.
 *
 * Two acquires racing for one exclusive lease is a way to lose to yourself, so an attempt already
 * in flight is joined rather than duplicated.
 */
function attempt(state: Availability, remembering: boolean): Step {
	if (state.kind === 'acquiring') {
		return {
			state: { kind: 'acquiring', remembering: state.remembering || remembering },
			effect: 'none'
		};
	}
	return { state: { kind: 'acquiring', remembering }, effect: 'acquire' };
}

export interface Explanation {
	headline: string;
	action: string;
	/** What was actually recorded, when the cause was not certain enough to assert. */
	detail?: string;
}

/**
 * What to tell the reader.
 *
 * The wording lives here rather than in a component so that FR-013's requirement — that the two
 * knowable causes call for *opposite* actions, and that an unknown one says so — can be asserted in
 * a test rather than reviewed by eye.
 */
export function explain(cause: Cause): Explanation {
	switch (cause.kind) {
		case 'another-copy':
			return {
				headline: 'This window cannot save right now.',
				action: 'Another window has your library open. Close it, then try again.'
			};

		case 'unavailable':
			return {
				headline: 'This device will not let the app store anything.',
				action:
					'Nothing you do here can be kept. This is not another window — it is something ' +
					'about this browser or device. Private browsing and full storage are the usual causes.',
				detail: cause.reason
			};

		case 'unknown':
			// Naming the likelier cause here would send the reader to close a window that is not
			// open, which is worse than admitting the app does not know.
			return {
				headline: 'This window cannot save right now.',
				action:
					'The app is not sure why. If you have the reader open anywhere else, close it and ' +
					'try again; if not, this is worth reporting.',
				detail: cause.reason
			};
	}
}
