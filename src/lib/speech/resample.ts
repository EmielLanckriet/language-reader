/**
 * The video's audio as the speech model hears it: mono, 16 kHz (research R4).
 *
 * A Kaiser-windowed sinc low-pass meant to match ffmpeg's default resampler (cutoff 0.97, beta 9,
 * 32 taps a side), which produced the 16 kHz audio every SenseVoice measurement used. Measured
 * against it: the same Chef Wang transcript, and 19 one-character changes on the street interview,
 * fewer than ffmpeg's two resamplers make against each other (29): near-tie scatter, not a worse
 * input. Ported from scripts/measure/sensevoice/resample.mjs.
 *
 * Computed a window at a time, so an hour of audio is never held decoded at once: `range` gives
 * output samples [fromOut, toOut) exactly as a whole-file run would, from input that covers
 * `inputFor(fromOut, toOut)`.
 */
export const SPEECH_RATE = 16000;

function bessel0(x: number): number {
	let s = 1;
	let t = 1;
	for (let k = 1; k < 30; k++) {
		t *= (x / (2 * k)) ** 2;
		s += t;
	}
	return s;
}

function gcd(a: number, b: number): number {
	return b ? gcd(b, a % b) : a;
}

export function downmix(channels: Float32Array[]): Float32Array {
	const mono = new Float32Array(channels[0].length);
	for (const c of channels) for (let i = 0; i < mono.length; i++) mono[i] += c[i] / channels.length;
	return mono;
}

export class Resampler {
	/** One filter per output phase: the input/output ratio repeats every `up` output samples. */
	private readonly table: Float32Array[] = [];
	private readonly up: number;
	private readonly down: number;
	/** Taps each side of the centre. */
	readonly reach: number;

	/** `inputLength`: the whole recording's input samples, since taps beyond its ends are absent. */
	constructor(
		readonly rate: number,
		readonly inputLength: number,
		{ half = 32, beta = 9, cutoff = 0.97 } = {}
	) {
		const g = gcd(rate, SPEECH_RATE);
		this.up = SPEECH_RATE / g; // 44100 → 16000: 160 up, 441 down
		this.down = rate / g;
		const scale = Math.min(1, SPEECH_RATE / rate);
		const fc = cutoff * scale;
		const w = (this.reach = Math.ceil(half / scale));
		const i0b = bessel0(beta);
		for (let p = 0; p < this.up; p++) {
			const frac = ((p * this.down) % this.up) / this.up;
			const taps = new Float32Array(2 * w + 1);
			let norm = 0;
			for (let k = -w; k <= w; k++) {
				const x = k - frac;
				const u = x / (w + 1);
				// In this order exactly: the measured version's, so the samples are the same bits.
				const win = bessel0(beta * Math.sqrt(Math.max(0, 1 - u * u))) / i0b;
				const sinc = x === 0 ? fc : Math.sin(Math.PI * fc * x) / (Math.PI * x);
				taps[k + w] = sinc * win;
				norm += sinc * win;
			}
			for (let k = 0; k < taps.length; k++) taps[k] /= norm;
			this.table.push(taps);
		}
	}

	/** How many output samples the whole recording gives. */
	get outputLength(): number {
		return Math.floor((this.inputLength * this.up) / this.down);
	}

	/** The input samples [from, to) that output samples [fromOut, toOut) are computed from. */
	inputFor(fromOut: number, toOut: number): [number, number] {
		const from = Math.floor((fromOut * this.down) / this.up) - this.reach;
		const to = Math.floor(((toOut - 1) * this.down) / this.up) + this.reach + 1;
		return [Math.max(0, from), Math.min(this.inputLength, to)];
	}

	/** Output samples [fromOut, toOut) from mono input whose first sample is input sample `base`. */
	range(mono: Float32Array, base: number, fromOut: number, toOut: number): Float32Array {
		if (this.rate === SPEECH_RATE) return mono.slice(fromOut - base, toOut - base);
		const out = new Float32Array(Math.max(0, toOut - fromOut));
		const w = this.reach;
		for (let j = fromOut; j < toOut; j++) {
			const centre = Math.floor((j * this.down) / this.up);
			const taps = this.table[j % this.up];
			let acc = 0;
			for (let k = -w; k <= w; k++) {
				const i = centre + k;
				if (i >= 0 && i < this.inputLength) acc += mono[i - base] * taps[k + w];
			}
			out[j - fromOut] = acc;
		}
		return out;
	}
}
