import { afterEach, expect, it, vi } from 'vitest';
import { loadMedia } from '../../src/lib/media/store';

// The origin private file system, in memory: just what store.ts uses.
function directory(files: Record<string, Blob> = {}, dirs: Record<string, unknown> = {}) {
	const handle = {
		kind: 'directory',
		async getDirectoryHandle(name: string, options?: { create?: boolean }) {
			if (!(name in dirs)) {
				if (!options?.create) throw new DOMException('missing', 'NotFoundError');
				dirs[name] = directory();
			}
			return dirs[name];
		},
		async *values() {
			for (const [name, blob] of Object.entries(files))
				yield { kind: 'file', name, getFile: async () => new File([blob], name) };
			for (const d of Object.values(dirs)) yield d;
		}
	};
	return handle;
}

afterEach(() => vi.unstubAllGlobals());

// Issue #45: an interrupted write leaves the file it created empty, and an empty sound-only.m4a
// was taken for a made one: never made again, and played by cards in place of the video.
it('takes an empty playable file for no file', async () => {
	const video = new Blob([new Uint8Array(64)]);
	const cues = new Blob(['WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n你好\n']);
	const media = directory(
		{},
		{
			'23': directory({ 'media.mp4': video, 'sound-only.m4a': new Blob([]), 'media.zh.vtt': cues }),
			'24': directory({ 'media.mp4': new Blob([]), 'sound-only.m4a': video, 'media.zh.vtt': cues })
		}
	);
	vi.stubGlobal('navigator', { storage: { getDirectory: async () => directory({}, { media }) } });

	const soundEmpty = await loadMedia(23);
	expect(soundEmpty?.sound).toBeUndefined();
	expect(soundEmpty?.media?.size).toBe(64);
	expect(soundEmpty?.cues).toHaveLength(1);

	const videoEmpty = await loadMedia(24);
	expect(videoEmpty?.media).toBeUndefined();
	expect(videoEmpty?.sound?.size).toBe(64);
});
