/**
 * The database file of the native build (ADR-0047): SQLite runs in this worker exactly as in the
 * browser, but its main file lives in memory here and on disk in the app's own folder, where
 * Chrome's storage eviction cannot reach it.
 *
 * Every transaction ends by releasing its write lock; the pages written since the previous release
 * go out then as one batch, which the native side appends to a checksummed log before folding it into the
 * file. A batch is a whole commit, so the file on disk is always some committed state: a crash
 * loses at most the commits whose batches had not arrived yet.
 *
 * Journals and temp files never leave memory. Losing them in a crash is harmless, because the disk
 * never holds a half-applied transaction for a journal to roll back.
 */

import type { Sqlite3Static } from '@sqlite.org/sqlite-wasm';

export const NATIVE_VFS = 'native-file';
const CHUNK = 4096;
const MAGIC = 0x31424452; // "RDB1"

interface File {
	data: Uint8Array;
	size: number;
	/** Main file only: chunk indices written since the last batch. */
	dirty?: Set<number>;
	sizeChanged?: boolean;
	deleteOnClose?: boolean;
	name?: string;
}

/** Why the file cannot be written any more, once a batch failed to land; null while it can. */
let broken: string | null = null;

let loading: { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void } | undefined;

/** Worker side: ask the page for the file, which only it can reach (Tauri is page-only). */
export function loadFromPage(): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		loading = { resolve, reject };
		self.postMessage({ kind: 'native-load' });
	});
}

/** Worker side: hand a batch to the page, which delivers batches to the shell in order. */
export function persistThroughPage(batch: ArrayBuffer): void {
	self.postMessage({ kind: 'native-commit', batch }, [batch]);
}

/** Worker side: the page's answer to a load, or news that the file cannot be written. */
export function fromPage(
	message:
		{ kind: 'native-loaded'; bytes: ArrayBuffer } | { kind: 'native-failed'; message: string }
): void {
	if (message.kind === 'native-loaded') loading?.resolve(new Uint8Array(message.bytes));
	else {
		broken ??= message.message;
		loading?.reject(new Error(message.message));
	}
	loading = undefined;
}

/** Encode the dirty chunks as a batch: magic, file size, count, then (offset, length, bytes)*. */
export function encodeBatch(file: { data: Uint8Array; size: number; dirty: Set<number> }) {
	const chunks = [...file.dirty].sort((a, b) => a - b).filter((i) => i * CHUNK < file.size);
	let length = 16;
	for (const i of chunks) length += 12 + Math.min(CHUNK, file.size - i * CHUNK);
	const out = new ArrayBuffer(length);
	const view = new DataView(out);
	const bytes = new Uint8Array(out);
	view.setUint32(0, MAGIC, true);
	view.setBigUint64(4, BigInt(file.size), true);
	view.setUint32(12, chunks.length, true);
	let at = 16;
	for (const i of chunks) {
		const offset = i * CHUNK;
		const n = Math.min(CHUNK, file.size - offset);
		view.setBigUint64(at, BigInt(offset), true);
		view.setUint32(at + 8, n, true);
		bytes.set(file.data.subarray(offset, offset + n), at + 12);
		at += 12 + n;
	}
	return out;
}

/**
 * Register the VFS with `initial` as the main file's content. `persist` receives each batch, in
 * commit order, and must deliver them in that order.
 */
export function installNativeFile(
	sqlite3: Sqlite3Static,
	mainName: string,
	initial: Uint8Array,
	persist: (batch: ArrayBuffer) => void,
	vfsName = NATIVE_VFS
): void {
	// The library's .d.ts describes the C structs, not the JS binder's `$` members and BigInt
	// offsets this talks to (opfs-sahpool uses the same ones), so the binder is untyped here.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { capi, wasm } = sqlite3 as any;
	const main: File = {
		data: initial,
		size: initial.length,
		dirty: new Set(),
		name: mainName
	};
	const named = new Map<string, File>();
	const open = new Map<number, File>();
	const fileOf = (p: unknown) => open.get(Number(p))!;

	function grow(file: File, size: number) {
		if (size <= file.data.length) return;
		const data = new Uint8Array(Math.max(size, Math.ceil(file.data.length * 1.5), 65536));
		data.set(file.data.subarray(0, file.size));
		file.data = data;
	}

	function flush(): number {
		if (broken) return capi.SQLITE_IOERR;
		if (main.dirty!.size === 0 && !main.sizeChanged) return 0;
		const batch = encodeBatch(main as File & { dirty: Set<number> });
		main.dirty!.clear();
		main.sizeChanged = false;
		persist(batch);
		return 0;
	}

	const io = new capi.sqlite3_io_methods();
	io.$iVersion = 1;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const { vfs: installer } = sqlite3 as any;
	installer.installVfs({
		io: {
			struct: io,
			methods: {
				xCheckReservedLock: (_p: number, pOut: number) => {
					wasm.poke32(pOut, 0);
					return 0;
				},
				xClose: (p: number) => {
					const file = fileOf(p);
					open.delete(Number(p));
					if (file === main) return flush();
					if (file.deleteOnClose && file.name) named.delete(file.name);
					return 0;
				},
				xDeviceCharacteristics: () => 0,
				xFileControl: () => capi.SQLITE_NOTFOUND,
				xFileSize: (p: number, pSize: number) => {
					wasm.poke64(pSize, BigInt(fileOf(p).size));
					return 0;
				},
				xLock: () => 0,
				xRead: (p: number, pDest: number, n: number, offset64: bigint) => {
					const file = fileOf(p);
					const offset = Number(offset64);
					const heap = wasm.heap8u();
					const available = Math.max(0, Math.min(n, file.size - offset));
					if (available > 0)
						heap.set(file.data.subarray(offset, offset + available), Number(pDest));
					if (available < n) {
						heap.fill(0, Number(pDest) + available, Number(pDest) + n);
						return capi.SQLITE_IOERR_SHORT_READ;
					}
					return 0;
				},
				xSectorSize: () => CHUNK,
				xSync: () => 0,
				xTruncate: (p: number, size64: bigint) => {
					const file = fileOf(p);
					if (file === main && broken) return capi.SQLITE_IOERR;
					const size = Number(size64);
					if (size > file.size) grow(file, size);
					else file.data.fill(0, size, file.size);
					file.size = size;
					if (file === main) main.sizeChanged = true;
					return 0;
				},
				// Below RESERVED no transaction is writing, so the file is exactly a committed state
				// (after a commit or a rollback alike): the one point a batch is always whole. Not
				// xSync: VACUUM truncates the file after its last sync.
				xUnlock: (p: number, lock: number) =>
					fileOf(p) === main && lock < capi.SQLITE_LOCK_RESERVED ? flush() : 0,
				xWrite: (p: number, pSrc: number, n: number, offset64: bigint) => {
					const file = fileOf(p);
					if (file === main && broken) return capi.SQLITE_IOERR;
					const offset = Number(offset64);
					grow(file, offset + n);
					file.data.set(wasm.heap8u().subarray(Number(pSrc), Number(pSrc) + n), offset);
					if (offset + n > file.size) {
						file.size = offset + n;
						if (file === main) main.sizeChanged = true;
					}
					if (file === main)
						for (let i = Math.floor(offset / CHUNK); i * CHUNK < offset + n; i++)
							main.dirty!.add(i);
					return 0;
				}
			}
		}
	});

	const vfs = new capi.sqlite3_vfs();
	const fallback = new capi.sqlite3_vfs(capi.sqlite3_vfs_find(null));
	vfs.$iVersion = 2;
	vfs.$szOsFile = capi.sqlite3_file.structInfo.sizeof;
	vfs.$mxPathname = 512;
	vfs.addOnDispose((vfs.$zName = wasm.allocCString(vfsName)));
	vfs.$xRandomness = fallback.$xRandomness;
	vfs.$xSleep = fallback.$xSleep;
	fallback.dispose();
	installer.installVfs({
		vfs: {
			struct: vfs,
			methods: {
				xAccess: (_v: number, zName: number, _flags: number, pOut: number) => {
					const name = wasm.cstrToJs(zName);
					wasm.poke32(pOut, name === mainName ? 1 : named.has(name) ? 1 : 0);
					return 0;
				},
				xCurrentTime: (_v: number, pOut: number) => {
					wasm.poke(pOut, 2440587.5 + Date.now() / 864e5, 'double');
					return 0;
				},
				xCurrentTimeInt64: (_v: number, pOut: number) => {
					wasm.poke(pOut, 2440587.5 * 864e5 + Date.now(), 'i64');
					return 0;
				},
				xDelete: (_v: number, zName: number) => {
					named.delete(wasm.cstrToJs(zName));
					return 0;
				},
				xFullPathname: (_v: number, zName: number, nOut: number, pOut: number) =>
					wasm.cstrncpy(pOut, zName, nOut) < nOut ? 0 : capi.SQLITE_CANTOPEN,
				xGetLastError: () => 0,
				xOpen: (_v: number, zName: number, pFile: number, flags: number, pOutFlags: number) => {
					const name = zName ? wasm.cstrToJs(zName) : null;
					let file: File | undefined;
					if (name === mainName) file = main;
					else if (name !== null && named.has(name)) file = named.get(name);
					else if (name === null || flags & capi.SQLITE_OPEN_CREATE) {
						file = { data: new Uint8Array(0), size: 0 };
						if (name !== null) {
							file.name = name;
							named.set(name, file);
						}
						file.deleteOnClose = name === null || !!(flags & capi.SQLITE_OPEN_DELETEONCLOSE);
					}
					if (!file) return capi.SQLITE_CANTOPEN;
					open.set(Number(pFile), file);
					const handle = new capi.sqlite3_file(pFile);
					handle.$pMethods = io.pointer;
					handle.dispose();
					if (pOutFlags) wasm.poke32(pOutFlags, flags);
					return 0;
				}
			}
		}
	});
}
