import { expect, it, vi } from 'vitest';
vi.mock('../../src/lib/storage/session', () => ({ session: vi.fn() }));
import { importExampleBundle, readExampleBundle } from '../../src/lib/media/example-bundle';
function tar(files: [string, string][]) {
	const parts: Uint8Array[] = [];
	for (const [name, text] of files) {
		const data = new TextEncoder().encode(text);
		const h = new Uint8Array(512);
		const put = (offset: number, value: string) => h.set(new TextEncoder().encode(value), offset);
		put(0, name);
		put(124, data.length.toString(8).padStart(11, '0') + '\0');
		h.fill(32, 148, 156);
		h[156] = 48;
		put(
			148,
			h
				.reduce((a, b) => a + b, 0)
				.toString(8)
				.padStart(6, '0') + '\0 '
		);
		parts.push(h, data, new Uint8Array((512 - (data.length % 512)) % 512));
	}
	parts.push(new Uint8Array(1024));
	return new Blob(parts as BlobPart[]);
}
it('reads a bounded bundle and rejects missing, duplicate and traversal audio entries', async () => {
	const name = 'a'.repeat(64) + '.mp3';
	const example = {
		key: 't:1',
		profile: 'Test',
		noteId: '1',
		word: '好',
		text: '你好。',
		translation: 'Hello.',
		pinyin: 'nǐ hǎo',
		original: {},
		sentenceAudio: name
	};
	const manifest = {
		format: 'reader-anki-examples',
		version: 1,
		examples: [example],
		audio: [{ name, id: 'a'.repeat(64), size: 3, mime: 'audio/mpeg' }]
	};
	const file: [string, string] = ['examples.json', JSON.stringify(manifest)];
	vi.stubGlobal('navigator', {
		storage: { getDirectory: async () => ({ getDirectoryHandle: async () => ({}) }) }
	});
	try {
		await expect(
			importExampleBundle(tar([file, ['audio/' + name, 'abc']]), () => {})
		).rejects.toThrow('damaged');
	} finally {
		vi.unstubAllGlobals();
	}
	const bundle = await readExampleBundle(tar([file, ['audio/' + name, 'abc']]));
	expect(bundle.examples[0].text).toBe('你好。');
	expect(await bundle.audio[0].blob.text()).toBe('abc');
	await expect(readExampleBundle(tar([file]))).rejects.toThrow('Incomplete');
	await expect(
		readExampleBundle(tar([file, ['audio/' + name, 'abc'], ['audio/' + name, 'abc']]))
	).rejects.toThrow('Unexpected');
	await expect(readExampleBundle(tar([file, ['../' + name, 'abc']]))).rejects.toThrow('Unexpected');
});

it('reads archive headers from bounded chunks rather than one storage request per recording', async () => {
	const audio = Array.from({ length: 128 }, (_, i) => {
		const id = i.toString(16).padStart(64, '0');
		return { name: `${id}.mp3`, id, size: 1, mime: 'audio/mpeg' };
	});
	const archive = tar([
		[
			'examples.json',
			JSON.stringify({ format: 'reader-anki-examples', version: 1, examples: [], audio })
		],
		...audio.map((entry) => [`audio/${entry.name}`, 'a'] as [string, string])
	]);
	const original = Blob.prototype.arrayBuffer;
	let reads = 0;
	vi.spyOn(Blob.prototype, 'arrayBuffer').mockImplementation(function (this: Blob) {
		reads++;
		return original.call(this);
	});
	await expect(readExampleBundle(archive)).resolves.toMatchObject({
		audio: { length: audio.length }
	});
	expect(reads).toBeLessThan(4);
});
