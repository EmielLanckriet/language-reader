/**
 * Where media files live (ADR-0051, issue #58): the origin-private file system in the browser,
 * the app's own files in the native build, which the WebView's storage eviction cannot reach (it
 * emptied OPFS on 2026-11-08 and left the database file alone).
 *
 * Paths are lists of names under one root: `['media', '12', 'meta.json']`. A stored file is read
 * through `MediaFile`, which a `File` already is: native files read their bytes by range from the
 * shell's `readermedia` scheme, so a video is never loaded whole and workers can read them too.
 */

import { NATIVE, invoke } from '$lib/native';

/** The reading half of a Blob, which is all that stored media is ever asked for. */
export interface Readable {
	readonly size: number;
	readonly type: string;
	arrayBuffer(): Promise<ArrayBuffer>;
	text(): Promise<string>;
	slice(start?: number, end?: number, contentType?: string): Readable;
}

/** A stored file: a `File` in the browser, a `NativeFile` in the native build. */
export interface MediaFile extends Readable {
	readonly name: string;
	readonly lastModified: number;
}

export interface Entry {
	name: string;
	kind: 'file' | 'directory';
}

/** What a write takes: bytes in memory, or a stored file (linked, not copied, natively). */
export type Source = Readable;

interface Listed {
	name: string;
	dir: boolean;
	size: number;
	modified: number;
}

const encode = (path: string[]) => path.map(encodeURIComponent).join('/');

function schemeBase(): string {
	return navigator.userAgent.includes('Android')
		? 'http://readermedia.localhost'
		: 'readermedia://localhost';
}

export class NativeFile implements MediaFile {
	readonly url: string;
	constructor(
		readonly path: string[],
		readonly size: number,
		readonly lastModified: number,
		readonly type = typeFor(path.at(-1)!),
		private readonly start = 0,
		private readonly full = size
	) {
		this.url = `${schemeBase()}/file/${encode(path)}`;
	}

	get name(): string {
		return this.path.at(-1)!;
	}

	/** The whole stored file, not a slice of it. */
	get whole(): boolean {
		return this.start === 0 && this.size === this.full;
	}

	slice(start = 0, end = this.size, contentType?: string): NativeFile {
		const clamp = (n: number) => Math.max(0, Math.min(this.size, n < 0 ? this.size + n : n));
		const from = clamp(start);
		const to = Math.max(from, clamp(end));
		return new NativeFile(
			this.path,
			to - from,
			this.lastModified,
			contentType ?? this.type,
			this.start + from,
			this.full
		);
	}

	/** The bytes, asked for by range until all have come: the shell cuts long ranges. */
	async arrayBuffer(): Promise<ArrayBuffer> {
		const out = new Uint8Array(this.size);
		let got = 0;
		while (got < this.size) {
			const from = this.start + got;
			const response = await fetch(this.url, {
				headers: { Range: `bytes=${from}-${this.start + this.size - 1}` },
				cache: 'no-store'
			});
			if (response.status !== 206) throw new Error(`Reading ${this.name}: ${response.status}`);
			const part = new Uint8Array(await response.arrayBuffer());
			if (part.length === 0) throw new Error(`Reading ${this.name}: it is shorter than listed`);
			out.set(part.subarray(0, this.size - got), got);
			got += part.length;
		}
		return out.buffer;
	}

	async text(): Promise<string> {
		return new TextDecoder().decode(await this.arrayBuffer());
	}
}

function typeFor(name: string): string {
	const extension = name.split('.').pop()?.toLowerCase();
	return (
		{
			mp4: 'video/mp4',
			webm: 'video/webm',
			m4a: 'audio/mp4',
			mp3: 'audio/mpeg',
			ogg: 'audio/ogg',
			opus: 'audio/ogg',
			wav: 'audio/wav',
			vtt: 'text/vtt',
			json: 'application/json',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			png: 'image/png',
			webp: 'image/webp'
		}[extension ?? ''] ?? ''
	);
}

/** A URL a media element plays from, and what to call when it is done with it. */
export function playbackUrl(file: Readable): { url: string; release: () => void } {
	if (file instanceof NativeFile) return { url: file.url, release: () => {} };
	const url = URL.createObjectURL(file as Blob);
	return { url, release: () => URL.revokeObjectURL(url) };
}

/** As a real Blob, for what only takes one (an upload, a worker message). Small files only. */
export async function asBlob(file: Readable): Promise<Blob> {
	return file instanceof Blob ? file : new Blob([await file.arrayBuffer()], { type: file.type });
}

// --- The browser's origin-private file system ---

async function opfsDirectory(
	path: string[],
	create: boolean
): Promise<FileSystemDirectoryHandle | null> {
	try {
		let directory = await navigator.storage.getDirectory();
		for (const part of path) directory = await directory.getDirectoryHandle(part, { create });
		return directory;
	} catch {
		return null;
	}
}

type Movable = FileSystemFileHandle & {
	move(target: FileSystemDirectoryHandle | string, name?: string): Promise<void>;
};

const opfs = {
	async entries(path: string[]): Promise<Entry[] | null> {
		const directory = await opfsDirectory(path, false);
		if (!directory) return null;
		const found: Entry[] = [];
		for await (const handle of directory.values()) {
			if (handle.kind === 'file' && handle.name.endsWith('.part')) continue;
			found.push({ name: handle.name, kind: handle.kind });
		}
		return found;
	},
	async files(path: string[]): Promise<MediaFile[] | null> {
		const directory = await opfsDirectory(path, false);
		if (!directory) return null;
		const found: MediaFile[] = [];
		for await (const handle of directory.values()) {
			if (handle.kind !== 'file' || handle.name.endsWith('.part')) continue;
			found.push(await (handle as FileSystemFileHandle).getFile());
		}
		return found;
	},
	async file(path: string[]): Promise<MediaFile | undefined> {
		const directory = await opfsDirectory(path.slice(0, -1), false);
		try {
			return await (await directory!.getFileHandle(path.at(-1)!)).getFile();
		} catch {
			return undefined;
		}
	},
	/** Written aside and moved into place, so an interruption leaves the previous whole version. */
	async write(path: string[], source: Source): Promise<void> {
		const directory = (await opfsDirectory(path.slice(0, -1), true))!;
		const name = path.at(-1)!;
		const aside = await directory.getFileHandle(`${name}.part`, { create: true });
		const writable = await aside.createWritable();
		await writable.write(await asBlob(source));
		await writable.close();
		await (aside as Movable).move(name);
	},
	async remove(path: string[]): Promise<void> {
		const directory = await opfsDirectory(path.slice(0, -1), false);
		await directory?.removeEntry(path.at(-1)!, { recursive: true }).catch(() => {});
	},
	async move(from: string[], to: string[]): Promise<void> {
		const source = (await opfsDirectory(from.slice(0, -1), false))!;
		const target = (await opfsDirectory(to.slice(0, -1), true))!;
		const handle = await source.getFileHandle(from.at(-1)!);
		await (handle as Movable).move(target, to.at(-1)!);
	}
};

// --- The native app's own files, through the shell ---

const PART = 1 << 20;

async function listNative(path: string[]): Promise<Listed[] | null> {
	const response = await fetch(`${schemeBase()}/list/${encode(path)}`, { cache: 'no-store' });
	if (response.status === 404) return null;
	if (!response.ok) throw new Error(`Listing ${path.join('/')}: ${await response.text()}`);
	return response.json();
}

function base64(bytes: Uint8Array): string {
	let binary = '';
	for (let i = 0; i < bytes.length; i += 0x8000)
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	return btoa(binary);
}

const native = {
	async entries(path: string[]): Promise<Entry[] | null> {
		const listed = await listNative(path);
		return listed && listed.map((e) => ({ name: e.name, kind: e.dir ? 'directory' : 'file' }));
	},
	async files(path: string[]): Promise<MediaFile[] | null> {
		const listed = await listNative(path);
		return (
			listed &&
			listed.filter((e) => !e.dir).map((e) => new NativeFile([...path, e.name], e.size, e.modified))
		);
	},
	async file(path: string[]): Promise<MediaFile | undefined> {
		const listed = await listNative(path.slice(0, -1)).catch(() => null);
		const found = listed?.find((e) => !e.dir && e.name === path.at(-1));
		return found && new NativeFile(path, found.size, found.modified);
	},
	async write(path: string[], source: Source): Promise<void> {
		const to = path.join('/');
		if (source instanceof NativeFile && source.whole) {
			await invoke('media_link', { from: source.path.join('/'), to });
			return;
		}
		// Bytes in memory (or a slice of a stored file): in parts, as db_commit sends batches.
		for (let at = 0, first = true; ; at += PART, first = false) {
			const last = at + PART >= source.size;
			const bytes = new Uint8Array(await source.slice(at, at + PART).arrayBuffer());
			await invoke('media_write', { path: to, part: base64(bytes), first, last });
			if (last) return;
		}
	},
	async remove(path: string[]): Promise<void> {
		await invoke('media_remove', { path: path.join('/') });
	},
	async move(from: string[], to: string[]): Promise<void> {
		await invoke('media_move', { from: from.join('/'), to: to.join('/') });
	}
};

export const files = NATIVE ? native : opfs;

/**
 * A Termux bundle unpacked by the shell into `staging/<name>/`, its files read from there: the
 * video goes from Termux to a file without crossing into the page. Native only.
 */
export async function takeBundle(url: string, name: string): Promise<MediaFile[]> {
	const dir = ['staging', name];
	const listed = await invoke<Listed[]>('media_take_bundle', { url, dir: dir.join('/') });
	return listed.map((e) => new NativeFile([...dir, e.name], e.size, e.modified));
}

/**
 * Native only, once: what an earlier build left in OPFS moves into the app's own files, and
 * leaves OPFS, so nothing is kept twice on a full phone. Folder by folder; a file already in the
 * app's files is kept as it is there.
 */
export async function moveOutOfBrowserStorage(roots = ['media', 'card-audio']): Promise<number> {
	if (!NATIVE) return 0;
	let moved = 0;
	const walk = async (path: string[]) => {
		for (const entry of (await opfs.entries(path)) ?? []) {
			const at = [...path, entry.name];
			if (entry.kind === 'directory') await walk(at);
			else {
				if (!(await native.file(at))) await native.write(at, (await opfs.file(at))!);
				moved++;
			}
		}
		await opfs.remove(path);
	};
	for (const root of roots) if (await opfsDirectory([root], false)) await walk([root]);
	return moved;
}

/** Natively, at start: bundles a closed app left unpacked go, then what OPFS still holds moves. */
export async function prepareMediaFiles(): Promise<void> {
	if (!NATIVE) return;
	await native.remove(['staging']).catch(() => {});
	const moved = await moveOutOfBrowserStorage();
	if (moved > 0) console.info(`Moved ${moved} media files out of browser storage`);
}
