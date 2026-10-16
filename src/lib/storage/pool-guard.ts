/**
 * Nothing in the storage worker may delete the SQLite pool's directories.
 *
 * When `installOpfsSAHPoolVfs` fails, sqlite-wasm 3.53 cleans up with `removeVfs()`, which deletes
 * the pool's `.opaque` directory, recursively: the reader's database. That delete is normally
 * refused, since the failure came from a file still held by the previous page. But when the
 * previous page lets go between the failure and the delete (#19's race on every quick navigation)
 * nothing stops it, and the library is gone. Shown by scripts/measure/sahpool-failed-install.
 *
 * Reader never removes a pool on purpose: it pauses and unpauses. So in this worker a removal of
 * either directory is refused, and the library's cleanup logs its failure and leaves the files.
 */

/** The library's defaults: the pool's own directory and the one holding its files. */
const POOL_DIRECTORIES = new Set(['.opfs-sahpool', '.opaque']);

let guarded = false;

export function guardPoolDirectory(): void {
	if (guarded || typeof FileSystemDirectoryHandle === 'undefined') return;
	guarded = true;
	const prototype = FileSystemDirectoryHandle.prototype;
	const remove = prototype.removeEntry;
	prototype.removeEntry = function (name: string, options?: FileSystemRemoveOptions) {
		if (POOL_DIRECTORIES.has(name)) {
			return Promise.reject(
				new DOMException(
					`Reader refuses to delete ${name}: it holds the database.`,
					'NoModificationAllowedError'
				)
			);
		}
		return remove.call(this, name, options);
	};
}
