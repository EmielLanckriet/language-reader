/**
 * Turning whatever was thrown into something worth reading.
 *
 * Split out of log.ts, which touches the database and therefore reaches SQLite. The interface needs
 * to describe an error without needing any of that: a page that imports `describeError` from a
 * module that leads to db.ts pulls the whole SQLite WebAssembly bundle onto the main thread, where
 * nothing runs it. `scripts/check-bundle.mjs` fails the build when that happens.
 *
 * This file imports nothing, which is the property that matters about it.
 */

/** Broad categories, so a reader can say *what kind* of thing broke without reading a stack. */
export type DiagnosticKind = 'storage' | 'analysis' | 'input' | 'persistence' | 'unexpected';

export interface Diagnostic {
	id: number;
	at: string;
	kind: DiagnosticKind | string;
	detail: string;
}

/** Turn whatever was thrown into something worth storing. */
export function describeError(error: unknown): string {
	if (error instanceof Error) {
		return error.stack
			? `${error.name}: ${error.message}\n${error.stack}`
			: `${error.name}: ${error.message}`;
	}
	return String(error);
}
