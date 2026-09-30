import { AUDIO_NAME, checkedExample, type AnkiExample } from '../domain/card-examples';
import { session } from '../storage/session';

interface Asset {
	name: string;
	id: string;
	size: number;
	mime: string;
	blob: Blob;
}
export interface ExampleBundle {
	examples: AnkiExample[];
	audio: Asset[];
}
const MIB = 1024 * 1024;
const HEADER_CACHE_BYTES = MIB;
const MIME: Record<string, string> = {
	mp3: 'audio/mpeg',
	m4a: 'audio/mp4',
	ogg: 'audio/ogg',
	opus: 'audio/ogg',
	wav: 'audio/wav'
};
const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes).replace(/\0.*$/s, '');

/** Restricted USTAR, from export_examples.py. Blob slices avoid loading the whole audio library. */
export async function readExampleBundle(file: Blob): Promise<ExampleBundle> {
	if (file.size > 2 * 1024 * MIB) throw new Error('This example bundle is too large.');
	let offset = 0;
	let cachedStart = -1;
	let cached = new Uint8Array();
	const headerAt = async (at: number) => {
		const start = Math.floor(at / HEADER_CACHE_BYTES) * HEADER_CACHE_BYTES;
		if (start !== cachedStart) {
			cachedStart = start;
			cached = new Uint8Array(
				await file.slice(start, Math.min(start + HEADER_CACHE_BYTES, file.size)).arrayBuffer()
			);
		}
		const relative = at - cachedStart;
		if (relative + 512 > cached.length) throw new Error('Invalid or truncated bundle file.');
		return cached.slice(relative, relative + 512);
	};
	let examples: AnkiExample[] | undefined;
	const expected = new Map<string, Omit<Asset, 'blob'>>();
	const found = new Map<string, Asset>();
	while (offset + 512 <= file.size) {
		const header = await headerAt(offset);
		if (header.every((byte) => byte === 0)) break;
		const octal = (from: number, to: number) => {
			const text = decode(header.slice(from, to)).trim();
			if (!/^[0-7]+$/.test(text)) throw new Error('Invalid archive number.');
			return parseInt(text, 8);
		};
		const checksum = header.reduce((sum, byte, i) => sum + (i >= 148 && i < 156 ? 32 : byte), 0);
		if (octal(148, 156) !== checksum) throw new Error('Damaged example archive header.');
		if (![0, 48].includes(header[156]) || decode(header.slice(345, 500)))
			throw new Error('Only ordinary bundle files are supported.');
		const name = decode(header.slice(0, 100));
		const size = octal(124, 136);
		const start = offset + 512;
		if (!Number.isSafeInteger(size) || size > 32 * MIB || start + size > file.size)
			throw new Error('Invalid or truncated bundle file.');
		const blob = file.slice(start, start + size);
		offset = start + Math.ceil(size / 512) * 512;
		if (!examples) {
			if (name !== 'examples.json') throw new Error('The bundle must start with examples.json.');
			const manifest = JSON.parse(await blob.text());
			if (
				manifest.format !== 'reader-anki-examples' ||
				manifest.version !== 1 ||
				!Array.isArray(manifest.examples) ||
				!Array.isArray(manifest.audio) ||
				manifest.examples.length > 30000 ||
				manifest.audio.length > 60000
			)
				throw new Error('Unsupported example bundle.');
			examples = manifest.examples.map(checkedExample);
			if (new Set(examples!.map((e) => e.key)).size !== examples!.length)
				throw new Error('Duplicate example identity.');
			for (const entry of manifest.audio) {
				if (
					typeof entry.name !== 'string' ||
					!AUDIO_NAME.test(entry.name) ||
					entry.id !== entry.name.slice(0, 64) ||
					!Number.isInteger(entry.size) ||
					entry.size <= 0 ||
					entry.size > 32 * MIB ||
					entry.mime !== MIME[entry.name.split('.').at(-1)!] ||
					expected.has('audio/' + entry.name)
				)
					throw new Error('Invalid audio manifest.');
				expected.set('audio/' + entry.name, {
					name: entry.name,
					id: entry.id,
					size: entry.size,
					mime: entry.mime
				});
			}
		} else {
			const asset = expected.get(name);
			if (!asset || found.has(name) || asset.size !== size)
				throw new Error('Unexpected or damaged audio file.');
			found.set(name, { ...asset, blob: blob.slice(0, blob.size, asset.mime) });
		}
	}
	if (!examples || found.size !== expected.size) throw new Error('Incomplete example bundle.');
	for (const example of examples)
		for (const field of ['wordAudio', 'sentenceAudio'] as const) {
			if (example[field] && !found.has('audio/' + example[field]))
				throw new Error('Example audio is missing from the bundle.');
		}
	return { examples, audio: [...found.values()] };
}
async function directory() {
	return (await navigator.storage.getDirectory()).getDirectoryHandle('card-audio', {
		create: true
	});
}
export async function exampleAudio(name: string): Promise<File | undefined> {
	if (!AUDIO_NAME.test(name)) return;
	try {
		return await (await (await directory()).getFileHandle(name)).getFile();
	} catch {
		return;
	}
}
export async function importExampleBundle(
	file: Blob,
	onProgress: (text: string) => void
): Promise<number> {
	onProgress('Checking example bundle…');
	const bundle = await readExampleBundle(file);
	const root = await directory();
	for (let i = 0; i < bundle.audio.length; i++) {
		const asset = bundle.audio[i];
		const bytes = await asset.blob.arrayBuffer();
		const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
			.map((byte) => byte.toString(16).padStart(2, '0'))
			.join('');
		if (hash !== asset.id) throw new Error('An audio file is damaged. Export the bundle again.');
		const handle = await root.getFileHandle(asset.name, { create: true });
		const writer = await handle.createWritable();
		await writer.write(asset.blob);
		await writer.close();
		if (i % 20 === 0 || i === bundle.audio.length - 1)
			onProgress(`Saving audio ${i + 1} of ${bundle.audio.length}…`);
	}
	onProgress('Saving example sentences…');
	return (await session()).repository.importCardExamples(bundle.examples);
}
