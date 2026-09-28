/**
 * SenseVoice-Small on onnxruntime-web: audio in, tokens with times out (research R1).
 *
 * Ported from scripts/measure/sensevoice/sensevoice.mjs, which reproduces sherpa-onnx v1.13.8's
 * preprocessing and was checked against it: features within 1e-4 of kaldi-native-fbank, text equal
 * except where the model's top two tokens are nearly tied (any change of runtime or CPU flips
 * those). scripts/measure/sensevoice/app-check.mjs checks this port against that module.
 */
import type * as Ort from 'onnxruntime-web';
import type { Token } from './windows';

export interface SenseVoiceMeta {
	revision: string;
	negMean: number[];
	invStddev: number[];
	lfrWindow: number;
	lfrShift: number;
	langZh: number;
	withoutItn: number;
}

const RATE = 16000;
const FRAME = 400; // 25 ms
const SHIFT = 160; // 10 ms
const FFT = 512;
const BINS = 80;
/** The model writes language, emotion, event and ITN tokens before the text. */
const PREFIX = 4;
/** Frame stacking (6) times the 10 ms frame shift. */
const TOKEN_SECONDS = 0.06;

function melBanks(): Float32Array[] {
	const mel = (f: number) => 1127 * Math.log(1 + f / 700);
	const lo = mel(20);
	const delta = (mel(RATE / 2) - lo) / (BINS + 1);
	const banks: Float32Array[] = [];
	for (let b = 0; b < BINS; b++) {
		const l = lo + b * delta;
		const c = l + delta;
		const r = c + delta;
		const w = new Float32Array(FFT / 2);
		for (let i = 0; i < FFT / 2; i++) {
			const m = mel((i * RATE) / FFT);
			if (m > l && m < r) w[i] = m <= c ? (m - l) / (c - l) : (r - m) / (r - c);
		}
		banks.push(w);
	}
	return banks;
}

const BANKS = melBanks();
const HAMMING = Float32Array.from(
	{ length: FRAME },
	(_, i) => 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (FRAME - 1))
);
const COS = Float64Array.from({ length: FFT / 2 }, (_, i) => Math.cos((-2 * Math.PI * i) / FFT));
const SIN = Float64Array.from({ length: FFT / 2 }, (_, i) => Math.sin((-2 * Math.PI * i) / FFT));

function fft(re: Float64Array, im: Float64Array): void {
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
				const wr = COS[k * step];
				const wi = SIN[k * step];
				const a = i + k;
				const b = a + len / 2;
				const tr = re[b] * wr - im[b] * wi;
				const ti = re[b] * wi + im[b] * wr;
				re[b] = re[a] - tr;
				im[b] = im[a] - ti;
				re[a] += tr;
				im[a] += ti;
			}
		}
	}
}

/**
 * Kaldi fbank as sherpa-onnx configures it for SenseVoice: snip edges, no dither, DC removed,
 * pre-emphasis 0.97, hamming, and samples scaled by 32768 (the model's `normalize_samples` is 0).
 */
export function fbank(samples: Float32Array): { data: Float32Array; frames: number } {
	const n = samples.length < FRAME ? 0 : 1 + Math.floor((samples.length - FRAME) / SHIFT);
	const out = new Float32Array(n * BINS);
	const re = new Float64Array(FFT);
	const im = new Float64Array(FFT);
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
		for (let i = 0; i < FRAME; i++) re[i] *= HAMMING[i];
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

/** Stack `lfrWindow` frames every `lfrShift`, padding with the edge frames (sherpa's lfr.cc), then CMVN. */
export function lfrCmvn(
	{ data, frames }: { data: Float32Array; frames: number },
	meta: SenseVoiceMeta
): { data: Float32Array; frames: number; dim: number } {
	const win = meta.lfrWindow;
	const dim = BINS * win;
	const outFrames = frames ? 1 + Math.floor((frames - 1) / meta.lfrShift) : 0;
	const out = new Float32Array(outFrames * dim);
	const left = (win - 1) >> 1;
	for (let i = 0; i < outFrames; i++) {
		const centre = i * meta.lfrShift;
		const pad = centre < left ? left - centre : 0;
		const first = centre < left ? 0 : centre - left;
		const maxOffset = frames - 1 - first;
		for (let j = 0; j < win; j++) {
			let src = 0;
			if (j >= pad) src = j - pad > maxOffset ? frames - 1 : first + j - pad;
			out.set(data.subarray(src * BINS, src * BINS + BINS), i * dim + j * BINS);
		}
	}
	for (let i = 0; i < out.length; i++) {
		const k = i % dim;
		out[i] = (out[i] + meta.negMean[k]) * meta.invStddev[k];
	}
	return { data: out, frames: outFrames, dim };
}

/**
 * The tokens in 16 kHz mono `samples`, timed from `offset` seconds. Chinese, number normalisation
 * off: with it on, numbers came out as 20到4000 for 两千到四千.
 */
export async function transcribeWindow(
	ort: typeof Ort,
	session: Ort.InferenceSession,
	tokens: string[],
	meta: SenseVoiceMeta,
	samples: Float32Array,
	offset: number
): Promise<Token[]> {
	const x = lfrCmvn(fbank(samples), meta);
	if (!x.frames) return [];
	const { logits } = await session.run({
		x: new ort.Tensor('float32', x.data, [1, x.frames, x.dim]),
		x_length: new ort.Tensor('int32', Int32Array.of(x.frames), [1]),
		language: new ort.Tensor('int32', Int32Array.of(meta.langZh), [1]),
		text_norm: new ort.Tensor('int32', Int32Array.of(meta.withoutItn), [1])
	});
	const [, frames, vocabulary] = logits.dims;
	const p = (await logits.getData()) as Float32Array;
	const found: Token[] = [];
	let previous = -1;
	let seen = 0;
	// Greedy CTC: the most likely token per frame, repeats merged, blanks (id 0) dropped.
	for (let t = 0; t < Math.min(frames, x.frames + PREFIX); t++) {
		let best = 0;
		for (let v = 1, o = t * vocabulary; v < vocabulary; v++) if (p[o + v] > p[o + best]) best = v;
		if (best !== 0 && best !== previous) {
			if (seen++ >= PREFIX)
				found.push([tokens[best].replaceAll('▁', ' '), offset + TOKEN_SECONDS * (t - PREFIX)]);
		}
		previous = best;
	}
	logits.dispose?.();
	return found;
}

/** sherpa-onnx's tokens.txt: `<symbol> <id>` per line. */
export function parseTokens(text: string): string[] {
	const table: string[] = [];
	for (const line of text.split('\n')) {
		const k = line.lastIndexOf(' ');
		if (k > 0) table[Number(line.slice(k + 1))] = line.slice(0, k);
	}
	return table;
}
