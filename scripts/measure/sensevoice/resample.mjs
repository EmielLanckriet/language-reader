// Downmix to mono and resample to 16 kHz with a Kaiser-windowed sinc low-pass, meant to match
// ffmpeg's default resampler (swr: cutoff 0.97, Kaiser beta 9, 32 taps a side), which produced the
// 16 kHz audio every SenseVoice measurement used. resample-check.mjs compares the two.
function bessel0(x) {
	let s = 1,
		t = 1;
	for (let k = 1; k < 30; k++) {
		t *= (x / (2 * k)) ** 2;
		s += t;
	}
	return s;
}

function gcd(a, b) {
	return b ? gcd(b, a % b) : a;
}

/** One filter per output phase: the input/output ratio repeats every `phases` output samples. */
function filters(rate, out, half, beta, cutoff) {
	const g = gcd(rate, out),
		up = out / g,
		down = rate / g; // 44100 → 16000: 160 up, 441 down
	const scale = Math.min(1, out / rate),
		fc = cutoff * scale,
		w = Math.ceil(half / scale),
		i0b = bessel0(beta);
	const table = [];
	for (let p = 0; p < up; p++) {
		const frac = ((p * down) % up) / up; // position of this phase's centre past its input sample
		const taps = new Float32Array(2 * w + 1);
		let norm = 0;
		for (let k = -w; k <= w; k++) {
			const x = k - frac,
				u = x / (w + 1);
			const win = bessel0(beta * Math.sqrt(Math.max(0, 1 - u * u))) / i0b;
			const s = x === 0 ? fc : Math.sin(Math.PI * fc * x) / (Math.PI * x);
			taps[k + w] = s * win;
			norm += s * win;
		}
		for (let k = 0; k < taps.length; k++) taps[k] /= norm;
		table.push(taps);
	}
	return { table, up, down, w };
}

export function toSpeech(channels, rate, out = 16000, { half = 32, beta = 9, cutoff = 0.97 } = {}) {
	const n = channels[0].length,
		mono = new Float32Array(n);
	for (const c of channels) for (let i = 0; i < n; i++) mono[i] += c[i] / channels.length;
	if (rate === out) return mono;
	const { table, up, down, w } = filters(rate, out, half, beta, cutoff);
	const len = Math.floor((n * up) / down),
		res = new Float32Array(len);
	for (let j = 0; j < len; j++) {
		const centre = Math.floor((j * down) / up),
			taps = table[j % up];
		let acc = 0;
		for (let k = -w; k <= w; k++) {
			const i = centre + k;
			if (i >= 0 && i < n) acc += mono[i] * taps[k + w];
		}
		res[j] = acc;
	}
	return res;
}
