/**
 * The worker that owns the database.
 *
 * SQLite has to live here rather than on the main thread, and the reason is narrow but absolute:
 * persisting to OPFS needs `FileSystemFileHandle.createSyncAccessHandle()`, and that method is
 * `[Exposed=DedicatedWorker]`. On the main thread it simply does not exist.
 *
 * Because the whole repository runs in here, it stays *synchronous* — the same code the tests
 * exercise directly against an in-memory database. Only the boundary is asynchronous.
 *
 * What is new in slice 1 is that the database is not simply opened once and kept. The storage lease
 * is exclusive per origin, so this worker takes it while the page is the one being looked at and
 * gives it back when the page is hidden. Which state that leaves things in is decided by
 * availability.ts, which is pure and tested; performed by lease.ts, which is not; and coordinated
 * here.
 */

import { type Database } from './db';
import { Repository } from './repository';
import { acquire, release } from './lease';
import { next, acceptsWrites, type Availability, type Event } from './availability';
import { clearDiagnostics, readDiagnostics, recordDiagnostic } from '../diagnostics/log';
import type { DiagnosticKind } from '../diagnostics/log';
import type { IngestedDocument } from '../content/types';
import type { AnalyzerStamp, ResolvedToken } from '../analyzer/resolve';
import type { Occurrence } from '../domain/types';
import type { Request, Response, ToWorker } from './protocol';

/**
 * The two calls that create data the reader earned, and the only ones that go through FR-015's
 * "try again, then carry out what they were doing" path. Everything else waits its turn instead.
 */
// Deliberately NOT including 'replaceTokens'. Re-derivation is the application catching up with
// itself, not the reader making a change: there is nothing to remember and retry on their behalf,
// and raising the read-only notice for background work would tell them something is wrong when
// nothing is. Without the lease it simply fails, the sweep moves on, and the document stays stale
// until a copy that can write picks it up (FR-019, FR-027).
const READER_CHANGES = new Set(['saveDocument', 'assertState']);

let state: Availability = { kind: 'paused' };
let db: Database | undefined;
let repository: Repository | undefined;

/** A change the reader made while this copy could not save, waiting on one attempt to take. */
let remembered: Request | undefined;

/** Calls that arrived before the lease did. Resolved when it arrives, rejected if it will not. */
let waiting: { run: () => void; giveUp: (cause: string) => void }[] = [];

// A page that is running is a page someone is looking at, until it says otherwise.
apply({ kind: 'became-visible' });

self.onmessage = (event: MessageEvent<ToWorker>) => {
	const message = event.data;

	if ('kind' in message) {
		if (message.kind === 'visibility') {
			apply({ kind: message.visible ? 'became-visible' : 'became-hidden' });
		} else {
			apply({ kind: 'reader-asked-to-retry' });
		}
		return;
	}

	handle(message);
};

function handle(request: Request): void {
	// A change the reader made. If this copy cannot save, the attempt to fix that happens *inside*
	// the action: it is either performed or refused, never held in hope (FR-012, FR-015).
	if (READER_CHANGES.has(request.method)) {
		if (acceptsWrites(state)) return respond(request);

		if (remembered) return fail(request, 'Another change is already waiting on storage.');
		remembered = request;
		apply({ kind: 'reader-attempted-change' });
		return;
	}

	// Everything else waits rather than being refused. This matters more than it looks: tying the
	// lease to visibility means every return to the foreground passes through `acquiring`, so a
	// read that resolved empty during it would show the reader an empty library every time they came
	// back — indistinguishable from having lost everything.
	if (state.kind === 'holding') return respond(request);
	if (state.kind === 'refused') return fail(request, describeRefusal(state));

	waiting.push({
		run: () => respond(request),
		giveUp: (cause) => fail(request, cause)
	});
}

function apply(event: Event): void {
	const step = next(state, event);
	const changed = step.state !== state;
	state = step.state;

	if (changed) announce();

	switch (step.effect) {
		case 'acquire':
			void take();
			break;
		case 'release':
			void give();
			break;
		case 'perform-remembered-change': {
			const request = remembered;
			remembered = undefined;
			drain();
			if (request) respond(request);
			break;
		}
		case 'none':
			if (state.kind === 'holding') drain();
			else if (state.kind === 'refused') abandon(describeRefusal(state));
			break;
	}
}

async function take(): Promise<void> {
	const result = await acquire();
	if (result.ok) {
		db = result.db;
		repository = new Repository(db);
		apply({ kind: 'acquire-succeeded' });
	} else {
		apply({ kind: 'acquire-failed', cause: result.cause });
	}
}

async function give(): Promise<void> {
	const closing = db;
	db = undefined;
	repository = undefined;
	await release(closing);
}

/** Let through everything that was waiting for the lease. */
function drain(): void {
	const queued = waiting;
	waiting = [];
	for (const item of queued) item.run();
}

/** Tell everything that was waiting that it is not going to happen. */
function abandon(cause: string): void {
	const queued = waiting;
	waiting = [];
	for (const item of queued) item.giveUp(cause);

	const request = remembered;
	remembered = undefined;
	if (request) fail(request, cause);
}

function describeRefusal(refused: Availability): string {
	if (refused.kind !== 'refused') return 'Storage is not available.';
	return refused.cause.kind === 'another-copy'
		? 'Another window has your library open, so this one cannot save.'
		: 'This device will not let the app store anything right now.';
}

function announce(): void {
	self.postMessage({ kind: 'availability', state } satisfies Response);
}

function respond(request: Request): void {
	try {
		self.postMessage({ kind: 'result', id: request.id, value: run(request) } satisfies Response);
	} catch (error) {
		const failure =
			error instanceof Error
				? { name: error.name, message: error.message }
				: { name: 'Error', message: String(error) };
		self.postMessage({ kind: 'failure', id: request.id, error: failure } satisfies Response);
	}
}

function fail(request: Request, message: string): void {
	self.postMessage({
		kind: 'failure',
		id: request.id,
		error: { name: 'StorageFailure', message }
	} satisfies Response);
}

/**
 * Dispatch one call.
 *
 * Written as an explicit switch rather than `repository[method](...args)`. The latter is shorter
 * and would let any message name a method — including one that was never meant to be reachable
 * from outside. This way the reachable surface is the list you can read.
 */
function run(request: Request): unknown {
	if (!repository || !db) throw new Error('The database is not open.');

	switch (request.method) {
		case 'listDocuments':
			return repository.listDocuments();
		case 'getDocument':
			return repository.getDocument(request.args[0]);
		case 'saveDocument':
			return repository.saveDocument(
				request.args[0] as IngestedDocument,
				request.args[1] as ResolvedToken[],
				request.args[2] as AnalyzerStamp
			);
		case 'assertState':
			return repository.assertState(
				request.args[0],
				request.args[1],
				request.args[2] as Occurrence | undefined
			);
		case 'getStates':
			return repository.getStates(request.args[0]);
		case 'readHistory':
			return repository.readHistory();
		case 'replaceTokens':
			return repository.replaceTokens(
				request.args[0],
				request.args[1] as ResolvedToken[],
				request.args[2] as AnalyzerStamp
			);
		case 'staleDocumentIds':
			return repository.staleDocumentIds(request.args[0], request.args[1]);
		case 'rebuildProjection':
			return repository.rebuildProjection();
		case 'readDiagnostics':
			return readDiagnostics(db, request.args[0]);
		case 'clearDiagnostics':
			return clearDiagnostics(db);
		case 'recordDiagnostic':
			return recordDiagnostic(db, request.args[0] as DiagnosticKind, request.args[1]);
	}
}
