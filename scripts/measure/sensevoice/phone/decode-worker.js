// Decode an ADTS AAC stream with WebCodecs in a worker, then downmix and resample to 16 kHz.
import { toSpeech } from '/resample.mjs';
onmessage = async ({ data: url }) => {
	try {
		const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
		const cfg = { codec: 'mp4a.40.2', sampleRate: 44100, numberOfChannels: 2 };
		const support = await AudioDecoder.isConfigSupported(cfg);
		if (!support.supported) return postMessage({ supported: false });
		const parts = [[], []];
		let rate = 0,
			channels = 0,
			frames = 0;
		const dec = new AudioDecoder({
			output: (d) => {
				rate = d.sampleRate;
				channels = d.numberOfChannels;
				frames += d.numberOfFrames;
				for (let c = 0; c < Math.min(2, channels); c++) {
					const a = new Float32Array(d.numberOfFrames);
					d.copyTo(a, { planeIndex: c, format: 'f32-planar' });
					parts[c].push(a);
				}
				d.close();
			},
			error: (e) => postMessage({ error: String(e) })
		});
		dec.configure(cfg);
		const t0 = performance.now();
		let at = 0,
			ts = 0,
			n = 0;
		while (at + 7 <= bytes.length) {
			const len = ((bytes[at + 3] & 3) << 11) | (bytes[at + 4] << 3) | (bytes[at + 5] >> 5);
			dec.decode(
				new EncodedAudioChunk({ type: 'key', timestamp: ts, data: bytes.subarray(at, at + len) })
			);
			ts += (1024 / 44100) * 1e6;
			at += len;
			n++;
		}
		await dec.flush();
		const decodeMs = performance.now() - t0;
		const join = (p) => {
			const out = new Float32Array(p.reduce((s, a) => s + a.length, 0));
			let o = 0;
			for (const a of p) {
				out.set(a, o);
				o += a.length;
			}
			return out;
		};
		const chans = parts.filter((p) => p.length).map(join);
		const t1 = performance.now();
		const speech = toSpeech(chans, rate);
		const resampleMs = performance.now() - t1;
		postMessage(
			{
				supported: true,
				chunks: n,
				rate,
				channels,
				frames,
				decodeMs: Math.round(decodeMs),
				resampleMs: Math.round(resampleMs),
				speech
			},
			[speech.buffer]
		);
	} catch (e) {
		postMessage({ error: String(e.stack || e) });
	}
};
