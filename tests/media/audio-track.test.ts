import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createFile, MP4BoxBuffer } from 'mp4box';
import { audioOnly } from '../../src/lib/media/audio-track';

// The video's sound alone, for the locked screen: one audio track, every sample of the original's,
// and nothing else (Chrome treats anything with a video track as video, and pauses it).

async function tracksOf(blob: Blob) {
	const file = createFile();
	let info: ReturnType<typeof file.getInfo> | undefined;
	file.onReady = (found) => (info = found);
	file.appendBuffer(MP4BoxBuffer.fromArrayBuffer(await blob.arrayBuffer(), 0));
	file.flush();
	return info!;
}

describe('the sound of a video', () => {
	it('is its audio track alone, whole', async () => {
		const video = new Blob([readFileSync('tests/fixtures/media/tiny.mp4')]);
		const original = await tracksOf(video);
		const sound = (await audioOnly(video))!;
		const made = await tracksOf(sound);

		expect(original.videoTracks).toHaveLength(1);
		expect(made.videoTracks).toHaveLength(0);
		expect(made.audioTracks).toHaveLength(1);
		expect(made.audioTracks[0].codec).toBe(original.audioTracks[0].codec);
		expect(made.audioTracks[0].nb_samples).toBe(original.audioTracks[0].nb_samples);
		expect(made.audioTracks[0].duration / made.audioTracks[0].timescale).toBeCloseTo(
			original.audioTracks[0].duration / original.audioTracks[0].timescale,
			2
		);
	});

	it('is nothing for a file without sound', async () => {
		expect(await audioOnly(new Blob([new Uint8Array(64)]))).toBeNull();
	});
});
