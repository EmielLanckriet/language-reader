// SenseVoice-Small on onnxruntime-web, reproducing sherpa-onnx v1.13.8's preprocessing
// (offline-recognizer-sense-voice-impl.h, kaldi-native-fbank, lfr.cc) so the output can be checked
// against sherpa-onnx (check.mjs). Features match kaldi-native-fbank to 1e-4; the text differs from
// sherpa's only where the model's top two tokens are nearly tied, which any change of runtime flips.

const RATE = 16000;
const FRAME = 400; // 25 ms
const SHIFT = 160; // 10 ms
const FFT = 512;
const BINS = 80;

function melBanks() {
	const mel = (f) => 1127 * Math.log(1 + f / 700);
	const lo = mel(20),
		hi = mel(RATE / 2);
	const delta = (hi - lo) / (BINS + 1);
	const width = RATE / FFT;
	const banks = [];
	for (let b = 0; b < BINS; b++) {
		const l = lo + b * delta,
			c = l + delta,
			r = c + delta;
		const w = new Float32Array(FFT / 2);
		for (let i = 0; i < FFT / 2; i++) {
			const m = mel(i * width);
			if (m > l && m < r) w[i] = m <= c ? (m - l) / (c - l) : (r - m) / (r - c);
		}
		banks.push(w);
	}
	return banks;
}

const BANKS = melBanks();
const WINDOW = Float32Array.from(
	{ length: FRAME },
	(_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1))
);
const COS = Float64Array.from({ length: FFT / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / FFT));
const SIN = Float64Array.from({ length: FFT / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / FFT));

function fft(re, im) {
	for (let i = 1, j = 0; i < FFT; i++) {
		let bit = FFT >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let len = 2; len <= FFT; len <<= 1) {
		const step = FFT / len;
		for (let i = 0; i < FFT; i += len) {
			for (let k = 0; k < len / 2; k++) {
				const wr = COS[k * step],
					wi = SIN[k * step];
				const a = i + k,
					b = a + len / 2;
				const tr = re[b] * wr - im[b] * wi,
					ti = re[b] * wi + im[b] * wr;
				re[b] = re[a] - tr;
				im[b] = im[a] - ti;
				re[a] += tr;
				im[a] += ti;
			}
		}
	}
}

/** Kaldi fbank as sherpa configures it for SenseVoice: snip edges, no dither, hamming, samples x 32768. */
export function fbank(samples) {
	const n = samples.length < FRAME ? 0 : 1 + Math.floor((samples.length - FRAME) / SHIFT);
	const out = new Float32Array(n * BINS);
	const re = new Float64Array(FFT),
		im = new Float64Array(FFT);
	for (let f = 0; f < n; f++) {
		re.fill(0);
		im.fill(0);
		let mean = 0;
		for (let i = 0; i < FRAME; i++) {
			re[i] = samples[f * SHIFT + i] * 32768;
			mean += re[i];
		}
		mean /= FRAME;
		for (let i = 0; i < FRAME; i++) re[i] -= mean;
		for (let i = FRAME - 1; i > 0; i--) re[i] -= 0.97 * re[i - 1];
		re[0] -= 0.97 * re[0];
		for (let i = 0; i < FRAME; i++) re[i] *= WINDOW[i];
		fft(re, im);
		for (let b = 0; b < BINS; b++) {
			const w = BANKS[b];
			let e = 0;
			for (let i = 0; i < FFT / 2; i++) if (w[i]) e += w[i] * (re[i] * re[i] + im[i] * im[i]);
			out[f * BINS + b] = Math.log(Math.max(e, 1.1920929e-7));
		}
	}
	return { data: out, frames: n };
}

/** Stack `win` frames every `shift` frames, left-padding with the first frame (lfr.cc), then CMVN. */
export function lfrCmvn({ data, frames }, meta) {
	const win = meta.lfrWindow,
		shift = meta.lfrShift,
		dim = BINS * win;
	const outFrames = frames ? 1 + Math.floor((frames - 1) / shift) : 0;
	const out = new Float32Array(outFrames * dim);
	const left = (win - 1) >> 1;
	for (let i = 0; i < outFrames; i++) {
		const centre = i * shift;
		const pad = centre < left ? left - centre : 0;
		const first = centre < left ? 0 : centre - left;
		const maxOffset = frames - 1 - first;
		for (let j = 0; j < win; j++) {
			let src = 0;
			if (j >= pad) {
				const o = j - pad;
				src = o > maxOffset ? frames - 1 : first + o;
			}
			out.set(data.subarray(src * BINS, src * BINS + BINS), i * dim + j * BINS);
		}
	}
	for (let i = 0; i < out.length; i++) {
		const k = i % dim;
		out[i] = (out[i] + meta.negMean[k]) * meta.invStddev[k];
	}
	return { data: out, frames: outFrames, dim };
}

/** Transcribe 16 kHz mono float samples. Returns text, tokens and per-token start times (s). */
export async function transcribe(ort, session, tokens, meta, samples, offset = 0) {
	const x = lfrCmvn(fbank(samples), meta);
	if (!x.frames) return { text: '', tokens: [], ts: [] };
	const feeds = {
		x: new ort.Tensor('float32', x.data, [1, x.frames, x.dim]),
		x_length: new ort.Tensor('int32', Int32Array.of(x.frames), [1]),
		language: new ort.Tensor('int32', Int32Array.of(meta.langZh), [1]),
		text_norm: new ort.Tensor('int32', Int32Array.of(meta.withoutItn), [1])
	};
	const { logits } = await session.run(feeds);
	const [, T, V] = logits.dims;
	const p = await logits.getData();
	const ids = [],
		at = [];
	let prev = -1;
	for (let t = 0; t < Math.min(T, x.frames + 4); t++) {
		let best = 0,
			bestV = -Infinity;
		for (let v = 0, o = t * V; v < V; v++)
			if (p[o + v] > bestV) {
				bestV = p[o + v];
				best = v;
			}
		if (best !== 0 && best !== prev) {
			ids.push(best);
			at.push(t);
		}
		prev = best;
	}
	logits.dispose?.();
	const syms = ids.slice(4).map((i) => tokens[i].replaceAll('▁', ' '));
	return { text: syms.join(''), tokens: syms, ts: at.slice(4).map((t) => offset + 0.06 * (t - 4)) };
}

/**
 * Where each window starts and ends, and which part of it is kept: windows of `win` s overlapping
 * by `overlap` s, each keeping its tokens up to the middle of the overlap. `first` makes the first
 * window shorter, so its lines arrive sooner (Principle VIII). SenseVoice is built for 30 s at most
 * (its README); longer windows drop phrases, and the overlap keeps words cut at a fixed boundary
 * whole. A pause detector was worse on street speech (docs/backlog.md).
 */
export function windowPlan(dur, { first = 30, win = 30, overlap = 2 } = {}) {
	const plan = [];
	for (let start = 0, len = first; ; start += len - overlap, len = win) {
		const end = Math.min(start + len, dur);
		plan.push({
			start,
			end,
			keepFrom: start ? start + overlap / 2 : 0,
			keepTo: end < dur ? end - overlap / 2 : Infinity
		});
		if (end >= dur) return plan;
	}
}

export async function transcribeLong(ort, session, tokens, meta, samples, options, onWindow) {
	const RATE_ = 16000,
		out = { tokens: [], ts: [] };
	for (const w of windowPlan(samples.length / RATE_, options)) {
		const r = await transcribe(
			ort,
			session,
			tokens,
			meta,
			samples.subarray(Math.round(w.start * RATE_), Math.round(w.end * RATE_)),
			w.start
		);
		r.ts.forEach((t, i) => {
			if (t >= w.keepFrom && t < w.keepTo) {
				out.tokens.push(r.tokens[i]);
				out.ts.push(t);
			}
		});
		onWindow?.(out, w.end);
	}
	return { ...out, text: out.tokens.join('') };
}

export function parseTokens(text) {
	const table = [];
	for (const line of text.split('\n')) {
		const k = line.lastIndexOf(' ');
		if (k > 0) table[Number(line.slice(k + 1))] = line.slice(0, k);
	}
	return table;
}

/** 16-bit PCM WAV bytes to float samples, finding the data chunk (ffmpeg adds a LIST chunk before it). */
export function wavSamples(bytes) {
	const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let at = 12;
	while (at + 8 <= v.byteLength) {
		const id = String.fromCharCode(
			v.getUint8(at),
			v.getUint8(at + 1),
			v.getUint8(at + 2),
			v.getUint8(at + 3)
		);
		const size = v.getUint32(at + 4, true);
		if (id === 'data') {
			const n = Math.min(size, v.byteLength - at - 8) >> 1;
			const out = new Float32Array(n);
			for (let i = 0; i < n; i++) out[i] = v.getInt16(at + 8 + 2 * i, true) / 32768;
			return out;
		}
		at += 8 + size + (size & 1);
	}
	throw new Error('no data chunk');
}
