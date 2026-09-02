/**
 * What storage throws when it cannot do what was asked.
 *
 * This is one class in its own file, which needs a word of justification under Principle V. It is
 * not an abstraction and nothing implements it — it is here because of *who imports it*.
 *
 * `client.ts` runs on the main thread and needs to construct this error when the worker reports a
 * failure. `repository.ts` runs inside the worker and throws it. If it lived in repository.ts, the
 * main thread's import would drag repository.ts, and therefore db.ts, and therefore the entire
 * SQLite WebAssembly bundle, into a graph that never executes any of it. That is exactly the
 * duplicate `scripts/check-bundle.mjs` exists to prevent, and it is the second instance of it
 * found in this file's history — the first was `requestPersistentStorage`.
 *
 * So the rule stands and this file is what keeps it: nothing the main thread imports may lead to
 * db.ts. A value import of a five-line error class is enough to break it, silently, in a way only
 * a build-size check notices.
 */
export class StorageFailure extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = 'StorageFailure';
	}
}
