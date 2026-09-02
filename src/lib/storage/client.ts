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
import type { Durability } from './db';
import type { Call, Failure, Ready, Request, Response } from './protocol';

export interface Opened {
	durability: Durability;
	fallbackReason?: string;
}

export class RepositoryClient {
	private readonly worker: Worker;
	private readonly pending = new Map<
		number,
		{ resolve: (value: unknown) => void; reject: (error: unknown) => void }
	>();
	private nextId = 1;

	/** Resolves when the worker has opened the database and said how it went. */
	readonly opened: Promise<Opened>;

	constructor() {
		this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

		let announce: (value: Opened) => void;
		this.opened = new Promise<Opened>((resolve) => {
			announce = resolve;
		});

		this.worker.onmessage = (event: MessageEvent<Response>) => {
			const message = event.data;
			if (message.kind === 'ready') {
				announce(readyToOpened(message));
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
			const error = new StorageFailure(`The storage worker stopped: ${event.message}`);
			for (const [, waiting] of this.pending) waiting.reject(error);
			this.pending.clear();
		};
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

function readyToOpened(message: Ready): Opened {
	return {
		durability: message.durability,
		...(message.fallbackReason ? { fallbackReason: message.fallbackReason } : {})
	};
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
