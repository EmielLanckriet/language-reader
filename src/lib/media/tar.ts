/**
 * Reading an uncompressed tar without loading it.
 *
 * Termux shares one file, and yt-dlp produces several (video, subtitles, metadata), so they travel
 * as a tar. Every member is a `Blob.slice` of the original: a 500 MB video is never copied into
 * memory, which on a phone is the difference between working and the tab being killed.
 */

export interface TarMember {
	name: string;
	size: number;
	blob: Blob;
}

const BLOCK = 512;

function field(header: Uint8Array, start: number, length: number): string {
	const bytes = header.subarray(start, start + length);
	const end = bytes.indexOf(0);
	return new TextDecoder().decode(end === -1 ? bytes : bytes.subarray(0, end));
}

export async function readTar(archive: Blob): Promise<TarMember[]> {
	const members: TarMember[] = [];
	let offset = 0;
	let longName: string | undefined;
	while (offset + BLOCK <= archive.size) {
		const header = new Uint8Array(await archive.slice(offset, offset + BLOCK).arrayBuffer());
		if (header.every((byte) => byte === 0)) break;
		const size = parseInt(field(header, 124, 12).trim() || '0', 8);
		const type = String.fromCharCode(header[156]);
		const data = offset + BLOCK;
		const prefix = field(header, 345, 155);
		let name = longName ?? (prefix ? `${prefix}/${field(header, 0, 100)}` : field(header, 0, 100));
		longName = undefined;
		if (type === 'L') {
			// GNU long name: the next header's name is this member's content.
			longName = field(
				new Uint8Array(await archive.slice(data, data + size).arrayBuffer()),
				0,
				size
			);
		} else if (type === '0' || type === '\0') {
			name = name.replace(/^\.\//, '');
			members.push({ name, size, blob: archive.slice(data, data + size) });
		}
		// 'x'/'g' pax headers and directories are skipped; their content is not needed here.
		offset = data + Math.ceil(size / BLOCK) * BLOCK;
	}
	return members;
}
