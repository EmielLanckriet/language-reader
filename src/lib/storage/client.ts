/**
 * The main thread's view of the database.
 *
 * Every method mirrors one on `Repository`, asynchronously. The repository itself is not here — it
 * runs inside the worker, synchronously, and is the same code the tests exercise directly. What
 * this file adds is only the crossing.
 */

import { RejectedInput } from '../content/types';
import { StorageFailure } from './failures';
import type { DocumentSummary, StoredDocument } from './repository';
import type { AnalyzerStamp, ResolvedToken } from '../analyzer/resolve';
import type { IngestedDocument } from '../content/types';
import type { HistoryEntry, LexemeId, Occurrence, WordState } from '../domain/types';
import type { Diagnostic, DiagnosticKind } from '../diagnostics/log';
import { explain, type Availability, type Explanation } from './availability';
import type { Call, Failure, Request, Response, ToWorker } from './protocol';

export class RepositoryClient {
	private worker!: Worker;
	private readonly pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: unknown) => void }
	>();
	private nextId = 1;
	private readonly watchers = new Set<(state: Availability) => void>();

	/**
	 * Whether this copy can save, as last reported by the worker.
	 *
	 * Pushed rather than polled, so the interface can say "this window cannot save" the moment it
	 * becomes true. It starts as `acquiring` because that is what the worker starts as, and because
	 * an interface that assumed `holding` before hearing otherwise would show a library it has not
	 * read yet.
	 */
	availability: Availability = { kind: 'acquiring', remembering: false };

	/**
	 * Whether the worker has already been replaced during the current run of bad luck.
	 *
	 * Reset every time the lease is actually held, so each new episode gets one free recovery and
	 * no episode can loop.
	 */
	private replacedOnce = false;

	constructor() {
		this.begin();
	}

	/**
	 * Start a worker, or start a fresh one.
	 *
	 * Replacing the worker is the only reliable way back from a failed handover, and the reason is
	 * a limitation rather than a preference. When one copy tries to reacquire the storage while
	 * another still holds the files, `unpauseVfs()` resolves without re-registering the VFS and
	 * leaves the pool unusable — and it cannot be reinstalled, because
	 * `installOpfsSAHPoolVfs` returns the same promise for the same pool name for the life of the
	 * module instance. A new worker is a new module instance, which is a new pool.
	 *
	 * Measured rather than assumed: pausing and unpausing works perfectly when nothing else is
	 * competing, and poisons the pool when something is.
	 */
	private begin(): void {
		this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

		this.worker.onmessage = (event: MessageEvent<Response>) => {
			const message = event.data;
			if (message.kind === 'availability') {
				this.availability = message.state;
				for (const watch of this.watchers) watch(message.state);

				if (message.state.kind === 'holding') this.replacedOnce = false;
				// One automatic recovery per episode. This is not the background polling FR-015a
				// forbids: it happens once, in response to an attempt the reader's own action or
				// their return to the app started, and then stops until they do something else.
				else if (message.state.kind === 'refused' && !this.replacedOnce) this.replace();
				return;
			}

			const waiting = this.pending.get(message.id);
			if (!waiting) return;
			this.pending.delete(message.id);

			if (message.kind === 'result') waiting.resolve(message.value);
			else waiting.reject(rebuild(message.error));
		};

		// A worker that dies takes every outstanding call with it. Failing them explicitly is the
		// difference between an error the reader can read and a screen that waits forever.
		this.worker.onerror = (event) => {
			this.abandonPending(new StorageFailure(`The storage worker stopped: ${event.message}`));
		};
	}

	private replace(): void {
		this.replacedOnce = true;
		this.worker.terminate();
		this.abandonPending(new StorageFailure('Reconnecting to your library.'));
		this.begin();
	}

	/**
	 * A worker that has gone takes every outstanding call with it. Failing them explicitly is the
	 * difference between an error the reader can read and a screen that waits forever.
	 */
	private abandonPending(error: Error): void {
		for (const [, waiting] of this.pending) waiting.reject(error);
		this.pending.clear();
	}

	/** Called whenever the answer to "can this copy save?" changes. Returns an unsubscribe. */
	watch(observer: (state: Availability) => void): () => void {
		this.watchers.add(observer);
		observer(this.availability);
		return () => this.watchers.delete(observer);
	}

	/** What to tell the reader, when there is something to tell them. FR-013. */
	get refusal(): Explanation | undefined {
		return this.availability.kind === 'refused' ? explain(this.availability.cause) : undefined;
	}

	/** The page telling the worker whether anyone is looking at this copy. Drives the lease. */
	setVisible(visible: boolean): void {
		this.worker.postMessage({ kind: 'visibility', visible } satisfies ToWorker);
	}

	/**
	 * The on-demand control from FR-015: try storage again, now, because the reader asked.
	 *
	 * A fresh worker rather than a message, when the current one has already given up. Asking a
	 * poisoned pool to try again has no effect, which would make the control a lie.
	 */
	retry(): void {
		if (this.availability.kind === 'refused') this.replace();
		else this.worker.postMessage({ kind: 'retry' } satisfies ToWorker);
	}

	private call<T>(call: Call): Promise<T> {
		const id = this.nextId++;
		return new Promise<T>((resolve, reject) => {
			this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
			this.worker.postMessage({ id, ...call } satisfies Request);
		});
	}

	listDocuments(): Promise<DocumentSummary[]> {
		return this.call({ method: 'listDocuments', args: [] });
	}

	getDocument(id: number): Promise<StoredDocument> {
		return this.call({ method: 'getDocument', args: [id] });
	}

	saveDocument(
		document: IngestedDocument,
		tokens: ResolvedToken[],
		analyzer: AnalyzerStamp
	): Promise<number> {
		return this.call({ method: 'saveDocument', args: [document, tokens, analyzer] });
	}

	assertState(lexemeId: LexemeId, asserted: string, occurrence?: Occurrence): Promise<void> {
		return this.call({ method: 'assertState', args: [lexemeId, asserted, occurrence] });
	}

	getStates(lexemeIds: LexemeId[]): Promise<Map<LexemeId, WordState>> {
		// A Map survives structuredClone intact, so it arrives as a Map rather than as an object.
		return this.call({ method: 'getStates', args: [lexemeIds] });
	}

	readHistory(): Promise<HistoryEntry[]> {
		return this.call({ method: 'readHistory', args: [] });
	}

	rebuildProjection(): Promise<void> {
		return this.call({ method: 'rebuildProjection', args: [] });
	}

	readDiagnostics(limit?: number): Promise<Diagnostic[]> {
		return this.call({ method: 'readDiagnostics', args: [limit] });
	}

	clearDiagnostics(): Promise<void> {
		return this.call({ method: 'clearDiagnostics', args: [] });
	}

	recordDiagnostic(kind: DiagnosticKind, detail: string): Promise<void> {
		return this.call({ method: 'recordDiagnostic', args: [kind, detail] });
	}
}

/**
 * Rebuild the error class from its name.
 *
 * `structuredClone` keeps `Error` but flattens the subclass, and the subclass is what ErrorNotice
 * uses to tell a refused input apart from a storage failure (FR-022). Losing it would collapse
 * two different situations into one message.
 */
function rebuild(failure: Failure): Error {
	if (failure.name === 'RejectedInput') return new RejectedInput(failure.message);
	if (failure.name === 'StorageFailure') return new StorageFailure(failure.message);
	const error = new Error(failure.message);
	error.name = failure.name;
	return error;
}
