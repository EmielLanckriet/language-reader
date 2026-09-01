/**
 * The worker that owns the database.
 *
 * SQLite has to live here rather than on the main thread, and the reason is narrow but absolute:
 * persisting to OPFS needs `FileSystemFileHandle.createSyncAccessHandle()`, and that method is
 * `[Exposed=DedicatedWorker]`. On the main thread it simply does not exist, so the SAH-pool VFS
 * refuses to install and everything falls back to an in-memory database that vanishes on reload.
 *
 * Because the whole repository runs in here, it stays *synchronous* — the same code the tests
 * exercise directly against an in-memory database. Only the boundary is asynchronous.
 */

import { openDatabase, type Database } from './db';
import { Repository } from './repository';
import { clearDiagnostics, readDiagnostics, recordDiagnostic } from '../diagnostics/log';
import type { DiagnosticKind } from '../diagnostics/log';
import type { IngestedDocument } from '../content/types';
import type { AnalyzerStamp, ResolvedToken } from '../analyzer/resolve';
import type { Occurrence } from '../domain/types';
import type { Request, Response } from './protocol';

let db: Database;
let repository: Repository;

const started = start();

async function start(): Promise<void> {
	const opened = await openDatabase();
	db = opened.db;
	repository = new Repository(db);

	const ready: Response = {
		kind: 'ready',
		durability: opened.durability,
		...(opened.fallbackReason ? { fallbackReason: opened.fallbackReason } : {})
	};
	self.postMessage(ready);

	if (opened.durability === 'memory') {
		recordDiagnostic(
			db,
			'storage',
			'OPFS was unavailable, so the database was opened in memory. Nothing saved will survive ' +
				`a reload. The reason it was unavailable: ${opened.fallbackReason ?? 'not reported'}`
		);
	}
}

self.onmessage = async (event: MessageEvent<Request>) => {
	const { id } = event.data;
	try {
		await started;
		self.postMessage({ kind: 'result', id, value: run(event.data) } satisfies Response);
	} catch (error) {
		const failure =
			error instanceof Error
				? { name: error.name, message: error.message }
				: { name: 'Error', message: String(error) };
		self.postMessage({ kind: 'failure', id, error: failure } satisfies Response);
	}
};

/**
 * Dispatch one call.
 *
 * Written as an explicit switch rather than `repository[method](...args)`. The latter is shorter
 * and would let any message name a method — including one that was never meant to be reachable
 * from outside. This way the reachable surface is the list you can read.
 */
function run(request: Request): unknown {
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
