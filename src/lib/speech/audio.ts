/**
 * A video's sound, decoded in Reader and resampled for the speech model, a window at a time
 * (research R4).
 *
 * The AAC samples come from mp4box, as for the audio-only copy (audio-track.ts), and are decoded by
 * WebCodecs: measured on the phone's Chrome in a worker, 231 s of audio in 4.1 s, and equal to the
 * laptop's to 142 dB after resampling. Decoded ahead only as far as the next window needs, so an
 * hour of video is never held decoded at once.
 *
 * Every window has its own decoder, started PREROLL frames early (#14). AAC's noise substitution
 * carries a random seed from frame to frame, so a decoder started mid-file never produces the
 * samples one started at frame 0 does, however early it starts (measured 2026-10-16: 2 to 2,048
 * frames of pre-roll still left hundreds of samples different at 30 to 90 minutes). One decoder
 * for the whole file made a resumed transcript differ from an uninterrupted one; a decoder per
 * window makes them the same computation. The words moved only at near ties: 17.8% character
 * errors against 18.3% on six film excerpts (scripts/measure/sensevoice/issue14). Eight frames,
 * since Android's AAC decoder (FDK) still settles after two.
 */
import type { Sample } from 'mp4box';
import { downmix, Resampler, SPEECH_RATE } from './resample';

const SLICE = 4 * 1024 * 1024;
/** Output samples per AAC-LC frame. */
const FRAME = 1024;
/** Frames decoded and discarded before each window, so the decoder has settled by its start. */
const PREROLL = 8;

export type AudioProblem = 'no audio track' | 'codec not supported';

export class SpeechAudio {
	private active: AudioDecoder | undefined;
	readonly resampler: Resampler;

	private constructor(
		private readonly samples: Sample[],
		private readonly timescale: number,
		private readonly config: AudioDecoderConfig
	) {
		this.resampler = new Resampler(config.sampleRate, samples.length * FRAME);
	}

	/** The audio of `video`, or why it cannot be had. */
	static async open(video: Blob): Promise<SpeechAudio | AudioProblem> {
		const { createFile, MP4BoxBuffer } = await import('mp4box');
		const file = createFile();
		const samples: Sample[] = [];
		let track:
			{ id: number; codec: string; timescale: number; rate: number; channels: number } | undefined;
		file.onReady = (info) => {
			const t = info.audioTracks[0];
			if (!t) return;
			track = {
				id: t.id,
				codec: t.codec,
				timescale: t.timescale,
				rate: t.audio!.sample_rate,
				channels: t.audio!.channel_count
			};
			file.setExtractionOptions(t.id, null, { nbSamples: Infinity });
			file.start();
		};
		file.onSamples = (_id, _user, found) => {
			for (const s of found) samples.push(s);
		};
		for (let start = 0; start < video.size; start += SLICE) {
			file.appendBuffer(
				MP4BoxBuffer.fromArrayBuffer(await video.slice(start, start + SLICE).arrayBuffer(), start)
			);
		}
		file.flush();
		if (!track || samples.length === 0) return 'no audio track';

		const config: AudioDecoderConfig = {
			codec: track.codec,
			sampleRate: track.rate,
			numberOfChannels: track.channels,
			description: decoderConfig(file.getTrackById(track.id))
		};
		if (!(await AudioDecoder.isConfigSupported(config)).supported) return 'codec not supported';
		return new SpeechAudio(samples, track.timescale, config);
	}

	/** Seconds of speech audio the video gives. */
	get duration(): number {
		return this.resampler.outputLength / SPEECH_RATE;
	}

	/** 16 kHz mono audio for [from, to) seconds, the same whichever windows came before. */
	async window(from: number, to: number): Promise<Float32Array> {
		const out0 = Math.round(from * SPEECH_RATE);
		const out1 = Math.min(Math.round(to * SPEECH_RATE), this.resampler.outputLength);
		const [lo, hi] = this.resampler.inputFor(out0, out1);
		const first = Math.max(0, Math.floor(lo / FRAME) - PREROLL);
		// Two frames past the end, since a decoder can hold a frame back until it sees the next.
		const last = Math.min(this.samples.length, Math.ceil(hi / FRAME) + 2);
		const decoded = await this.decode(first, last);
		return this.resampler.range(decoded, first * FRAME, out0, out1);
	}

	close(): void {
		if (this.active && this.active.state !== 'closed') this.active.close();
	}

	/** Frames [first, last) decoded by a decoder of their own, as mono input samples. */
	private async decode(first: number, last: number): Promise<Float32Array> {
		const parts: Float32Array[] = [];
		let failure: Error | undefined;
		const decoder = new AudioDecoder({
			output: (data) => {
				// The recording's length was taken as samples x 1024, which is AAC-LC; HE-AAC gives 2048.
				if (data.numberOfFrames !== FRAME && last < this.samples.length)
					failure ??= new Error('codec not supported');
				parts.push(mono(data));
			},
			error: (e) => (failure ??= e instanceof Error ? e : new Error(String(e)))
		});
		this.active = decoder;
		try {
			decoder.configure(this.config);
			for (let i = first; i < last; i++) decoder.decode(this.chunk(this.samples[i]));
			await decoder.flush();
		} catch (error) {
			throw failure ?? error;
		} finally {
			if (decoder.state !== 'closed') decoder.close();
		}
		if (failure) throw failure;
		const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
		let at = 0;
		for (const p of parts) {
			joined.set(p, at);
			at += p.length;
		}
		return joined;
	}

	private chunk(sample: Sample): EncodedAudioChunk {
		return new EncodedAudioChunk({
			type: 'key',
			timestamp: Math.round((sample.cts * 1e6) / this.timescale),
			duration: Math.round((sample.duration * 1e6) / this.timescale),
			data: sample.data!
		});
	}
}

function mono(data: AudioData): Float32Array {
	const channels: Float32Array[] = [];
	for (let c = 0; c < data.numberOfChannels; c++) {
		const plane = new Float32Array(data.numberOfFrames);
		data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
		channels.push(plane);
	}
	data.close();
	return downmix(channels);
}

/** The AudioSpecificConfig inside the track's esds box: what the decoder needs to read raw AAC. */
function decoderConfig(track: unknown): Uint8Array | undefined {
	// mp4box's types do not reach this deep; the path is the one esds always has.
	const entry = (
		track as {
			mdia: {
				minf: {
					stbl: {
						stsd: { entries: { esds?: { esd: { descs: { descs: { data: Uint8Array }[] }[] } } }[] };
					};
				};
			};
		}
	).mdia.minf.stbl.stsd.entries[0];
	return entry.esds?.esd.descs[0]?.descs[0]?.data;
}
