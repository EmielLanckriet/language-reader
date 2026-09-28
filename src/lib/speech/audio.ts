/**
 * A video's sound, decoded in Reader and resampled for the speech model, a window at a time
 * (research R4).
 *
 * The AAC samples come from mp4box, as for the audio-only copy (audio-track.ts), and are decoded by
 * WebCodecs: measured on the phone's Chrome in a worker, 231 s of audio in 4.1 s, and equal to the
 * laptop's to 142 dB after resampling. Decoded ahead only as far as the next window needs, so an
 * hour of video is never held decoded at once.
 *
 * The decoder runs forward without seeking: each AAC frame's output depends on the frame before
 * it, so starting mid-file would change the samples at the start. Windows are consecutive, and a
 * resumed transcript starts two frames early and discards them.
 */
import type { Sample } from 'mp4box';
import { downmix, Resampler, SPEECH_RATE } from './resample';

const SLICE = 4 * 1024 * 1024;
/** Output samples per AAC-LC frame. */
const FRAME = 1024;

export type AudioProblem = 'no audio track' | 'codec not supported';

export class SpeechAudio {
	private readonly decoder: AudioDecoder;
	private next = 0; // the next compressed sample to decode
	private decoded = 0; // input samples decoded so far, counted from the first frame decoded
	private started = 0; // input sample at which decoding started
	// Decoded mono input from `base`: whole buffer plus parts not yet joined, so that decoding a
	// window appends ~1,300 frames without copying the growing buffer each time.
	private buffer = new Float32Array(0);
	private parts: Float32Array[] = [];
	private base = 0;
	private waiting: (() => void) | undefined;
	private failure: Error | undefined;
	readonly resampler: Resampler;

	private constructor(
		private readonly samples: Sample[],
		private readonly timescale: number,
		config: AudioDecoderConfig
	) {
		this.resampler = new Resampler(config.sampleRate, samples.length * FRAME);
		this.decoder = new AudioDecoder({
			output: (data) => this.take(data),
			error: (e) => {
				this.failure = e instanceof Error ? e : new Error(String(e));
				this.waiting?.();
			}
		});
		this.decoder.configure(config);
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

	/** 16 kHz mono audio for [from, to) seconds. Calls must move forward through the recording. */
	async window(from: number, to: number): Promise<Float32Array> {
		const out0 = Math.round(from * SPEECH_RATE);
		const out1 = Math.min(Math.round(to * SPEECH_RATE), this.resampler.outputLength);
		const [lo, hi] = this.resampler.inputFor(out0, out1);
		if (this.next === 0 && this.decoded === 0 && lo > 0) this.startAt(lo);
		await this.decodeThrough(hi);
		this.join();
		this.dropBefore(lo);
		return this.resampler.range(this.buffer, this.base, out0, out1);
	}

	close(): void {
		if (this.decoder.state !== 'closed') this.decoder.close();
	}

	/** Resuming: start two frames before `input`, so the decoder has settled by then. */
	private startAt(input: number): void {
		this.next = Math.max(0, Math.floor(input / FRAME) - 2);
		this.started = this.base = this.next * FRAME;
	}

	private async decodeThrough(input: number): Promise<void> {
		while (this.started + this.decoded < input) {
			if (this.failure) throw this.failure;
			if (this.next < this.samples.length) {
				// Two frames ahead of what is needed, since the decoder holds a frame back.
				const want = Math.min(this.samples.length, Math.ceil(input / FRAME) + 2);
				for (; this.next < want; this.next++) this.feed(this.samples[this.next]);
				if (this.next === this.samples.length) await this.decoder.flush();
			}
			if (this.started + this.decoded < input) {
				if (this.next >= this.samples.length && this.decoder.decodeQueueSize === 0) return;
				await new Promise<void>((resolve) => (this.waiting = resolve));
			}
		}
	}

	private feed(sample: Sample): void {
		this.decoder.decode(
			new EncodedAudioChunk({
				type: 'key',
				timestamp: Math.round((sample.cts * 1e6) / this.timescale),
				duration: Math.round((sample.duration * 1e6) / this.timescale),
				data: sample.data!
			})
		);
	}

	private take(data: AudioData): void {
		// The recording's length was taken as samples x 1024, which is AAC-LC; HE-AAC gives 2048.
		if (data.numberOfFrames !== FRAME && this.next < this.samples.length) {
			this.failure = new Error('codec not supported');
		}
		const channels: Float32Array[] = [];
		for (let c = 0; c < data.numberOfChannels; c++) {
			const plane = new Float32Array(data.numberOfFrames);
			data.copyTo(plane, { planeIndex: c, format: 'f32-planar' });
			channels.push(plane);
		}
		data.close();
		const mono = downmix(channels);
		this.parts.push(mono);
		this.decoded += mono.length;
		const resolve = this.waiting;
		this.waiting = undefined;
		resolve?.();
	}

	private join(): void {
		if (this.parts.length === 0) return;
		const joined = new Float32Array(
			this.buffer.length + this.parts.reduce((n, p) => n + p.length, 0)
		);
		joined.set(this.buffer);
		let at = this.buffer.length;
		for (const p of this.parts) {
			joined.set(p, at);
			at += p.length;
		}
		this.buffer = joined;
		this.parts = [];
	}

	private dropBefore(input: number): void {
		if (input <= this.base) return;
		this.buffer = this.buffer.slice(input - this.base);
		this.base = input;
	}
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
