/**
 * The messages that cross the worker boundary.
 *
 * Shared by both sides so a change to one is a type error on the other, rather than a runtime
 * surprise that only appears on the phone.
 */

import type { Availability } from './availability';

/** Methods the worker will run on the repository, named rather than sent as functions. */
export type Call =
	| { method: 'listDocuments'; args: [] }
	| { method: 'getDocument'; args: [number] }
	| { method: 'saveDocument'; args: [unknown, unknown, unknown] }
	| { method: 'assertState'; args: [number, string, unknown?] }
	| { method: 'getStates'; args: [number[]] }
	| { method: 'readHistory'; args: [] }
	| { method: 'replaceTokens'; args: [number, unknown, unknown] }
	| { method: 'advanceUpgrade'; args: [number, unknown, unknown] }
	| { method: 'staleDocumentIds'; args: [string, string] }
	| { method: 'rebuildProjection'; args: [] }
	| { method: 'readDiagnostics'; args: [number?] }
	| { method: 'clearDiagnostics'; args: [] }
	| { method: 'recordDiagnostic'; args: [string, string] };

export type Request = { id: number } & Call;

/**
 * Messages that are not calls: things the page knows and the worker cannot see for itself.
 *
 * Visibility is the important one. The worker holds the storage lease only while the page is the
 * one being looked at, and `document.visibilityState` is `[Exposed=Window]` — so the page has to
 * tell it.
 */
export type Control = { kind: 'visibility'; visible: boolean } | { kind: 'retry' };

export type ToWorker = Request | Control;

/**
 * Errors are flattened to a name and a message.
 *
 * `structuredClone` preserves `Error` but not its subclass, and the interface needs the subclass:
 * FR-022 says a refused input and a storage failure must read differently. The name is carried
 * across explicitly and the class rebuilt on the other side.
 */
export interface Failure {
	name: string;
	message: string;
}

export type Response =
	/**
	 * Pushed whenever it changes, never asked for. The interface has to be able to say "this window
	 * cannot save" the moment it becomes true, and a screen that had to poll for it would show a
	 * stale answer for exactly as long as it mattered.
	 */
	| { kind: 'availability'; state: Availability }
	| { kind: 'result'; id: number; value: unknown }
	| { kind: 'failure'; id: number; error: Failure };
