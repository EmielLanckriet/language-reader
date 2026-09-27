/**
 * The sound of a video as an audio-only file, for listening with the screen locked.
 *
 * Measured on the phone (2026-09-27): Chrome pauses a hidden video within seconds, refuses to
 * start an element playing an MP4 while hidden ("video-only background media was paused to save
 * power"), and freezes one already playing; an audio-only M4A plays on locked, and starts locked.
 * So the video's audio track is copied, not re-encoded, into an M4A of its own. Derived: made
 * again from the video whenever it is missing.
 */

import type { IsoFileOptions, Sample } from 'mp4box';

/** Read in slices, so a long video is never all in memory at once. */
const SLICE = 4 * 1024 * 1024;

/** The audio track of an MP4 as an M4A, or null when the file has no audio track mp4box can read. */
export async function audioOnly(video: Blob): Promise<Blob | null> {
	const { createFile, MP4BoxBuffer } = await import('mp4box');
	const input = createFile();
	const samples: Sample[] = [];
	let trackId: number | undefined;
	input.onReady = (info) => {
		const track = info.audioTracks[0];
		if (!track) return;
		trackId = track.id;
		input.setExtractionOptions(track.id, null, { nbSamples: Infinity });
		input.start();
	};
	input.onSamples = (_id, _user, found) => {
		for (const sample of found) samples.push(sample);
	};
	for (let start = 0; start < video.size; start += SLICE) {
		const buffer = MP4BoxBuffer.fromArrayBuffer(
			await video.slice(start, start + SLICE).arrayBuffer(),
			start
		);
		input.appendBuffer(buffer);
	}
	input.flush();
	if (trackId === undefined || samples.length === 0) return null;

	const track = input.getTrackById(trackId);
	const entry = track.mdia.minf.stbl.stsd.entries[0];
	const info = input.getInfo().audioTracks.find((t) => t.id === trackId)!;
	const output = createFile();
	const id = output.addTrack({
		type: entry.type as 'mp4a',
		hdlr: 'soun',
		timescale: info.timescale,
		duration: info.duration,
		media_duration: info.duration,
		language: info.language,
		samplerate: info.audio?.sample_rate,
		channel_count: info.audio?.channel_count,
		samplesize: info.audio?.sample_size,
		// The original entry's own boxes (esds: the AAC settings a decoder needs), not the entry
		// itself, which mp4box would nest inside the new one, leaving no esds at the top.
		description_boxes: entry.boxes as NonNullable<IsoFileOptions['description_boxes']>,
		brands: ['M4A ', 'isom', 'mp42']
	});
	for (const sample of samples) {
		output.addSample(id, sample.data!, {
			duration: sample.duration,
			dts: sample.dts,
			cts: sample.cts,
			is_sync: sample.is_sync
		});
	}
	const stream = output.getBuffer();
	return new Blob([new Uint8Array(stream.buffer, 0, stream.byteLength)], { type: 'audio/mp4' });
}
