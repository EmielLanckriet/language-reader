/**
 * The messages that cross the worker boundary.
 *
 * Shared by both sides so a change to one is a type error on the other, rather than a runtime
 * surprise that only appears on the phone.
 */

import type { Durability } from './db';

/** Methods the worker will run on the repository, named rather than sent as functions. */
export type Call =
	| { method: 'listDocuments'; args: [] }
	| { method: 'getDocument'; args: [number] }
	| { method: 'saveDocument'; args: [unknown, unknown, unknown] }
	| { method: 'assertState'; args: [number, string, unknown?] }
	| { method: 'getStates'; args: [number[]] }
	| { method: 'readHistory'; args: [] }
	| { method: 'rebuildProjection'; args: [] }
	| { method: 'readDiagnostics'; args: [number?] }
	| { method: 'clearDiagnostics'; args: [] }
	| { method: 'recordDiagnostic'; args: [string, string] };

export type Request = { id: number } & Call;

/**
 * What the worker learned when it opened the database. Sent once, unprompted, when it is ready —
 * so the first screen does not have to ask before it can say whether storage is durable.
 */
export interface Ready {
	kind: 'ready';
	durability: Durability;
	/** Why OPFS was not used, when it was not. Absent when storage is durable. */
	fallbackReason?: string;
}

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
	| Ready
	| { kind: 'result'; id: number; value: unknown }
	| { kind: 'failure'; id: number; error: Failure };
