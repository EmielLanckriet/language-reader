// Issue #14, a second pass: the app's pipeline (src/lib/speech/: features, window plan, keep rule)
// over a recording twice — the app's windows, and windows shifted by half a step — keeping each
// token's score: the CTC posterior of the token, highest over the frames it was emitted from.
// The tokens are checked against the app's own transcribeWindow, so the scores ride on exactly
// the app's output.
//   node passes.mjs <model dir> <f32 44.1 kHz stereo> <shift seconds> > passes.json
import * as ort from 'onnxruntime-node';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const here = new URL('../', import.meta.url);
const { parseTokens } = await import(new URL('sensevoice.mjs', here));
const [M, input, shiftArg = '4'] = process.argv.slice(2);
const vite = await createServer({
	configFile: false,
	root: new URL('../../../..', import.meta.url).pathname,
	server: { middlewareMode: true },
	appType: 'custom',
	logLevel: 'error'
});
const load = (p) => vite.ssrLoadModule(p);
const { transcribeWindow, fbank, lfrCmvn } = await load('/src/lib/speech/pipeline.ts');
const { windowPlan, keep, WINDOWS } = await load('/src/lib/speech/windows.ts');
const { Resampler, downmix } = await load('/src/lib/speech/resample.ts');
const meta = JSON.parse(
	readFileSync(new URL('../../../../src/lib/speech/sense-voice-meta.json', import.meta.url))
);
const vocab = parseTokens(readFileSync(`${M}/tokens.txt`, 'utf8'));
const session = await ort.InferenceSession.create(readFileSync(`${M}/model.int8.onnx`), {
	intraOpNumThreads: 4
});

const PREFIX = 4;
const TOKEN_SECONDS = 0.06;
/** transcribeWindow's greedy CTC, also giving each token's posterior and its top-two margin. */
async function scored(samples, offset) {
	const x = lfrCmvn(fbank(samples), meta);
	if (!x.frames) return [];
	const { logits } = await session.run({
		x: new ort.Tensor('float32', x.data, [1, x.frames, x.dim]),
		x_length: new ort.Tensor('int32', Int32Array.of(x.frames), [1]),
		language: new ort.Tensor('int32', Int32Array.of(meta.langZh), [1]),
		text_norm: new ort.Tensor('int32', Int32Array.of(meta.withoutItn), [1])
	});
	const [, frames, V] = logits.dims;
	const p = logits.data;
	const found = [];
	let previous = -1,
		seen = 0,
		current;
	for (let t = 0; t < Math.min(frames, x.frames + PREFIX); t++) {
		const o = t * V;
		let best = 0,
			second = -1;
		for (let v = 1; v < V; v++) if (p[o + v] > p[o + best]) best = v;
		for (let v = 0; v < V; v++)
			if (v !== best && (second < 0 || p[o + v] > p[o + second])) second = v;
		let z = 0;
		for (let v = 0; v < V; v++) z += Math.exp(p[o + v] - p[o + best]);
		const post = 1 / z;
		if (best !== 0 && best !== previous) {
			if (seen++ >= PREFIX) {
				current = [
					vocab[best].replaceAll('▁', ' '),
					offset + TOKEN_SECONDS * (t - PREFIX),
					post,
					p[o + best] - p[o + second]
				];
				found.push(current);
			} else current = undefined;
		} else if (best !== 0 && best === previous && current) {
			current[2] = Math.max(current[2], post);
			current[3] = Math.max(current[3], p[o + best] - p[o + second]);
		}
		if (best === 0) current = undefined;
		previous = best;
	}
	return { found, x: { frames: x.frames } };
}

const b = readFileSync(input);
const f = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
const L = new Float32Array(f.length / 2),
	R = new Float32Array(f.length / 2);
for (let i = 0; i < L.length; i++) {
	L[i] = f[2 * i];
	R[i] = f[2 * i + 1];
}
const mono = downmix([L, R]);
const rs = new Resampler(44100, mono.length);
const duration = rs.outputLength / 16000;
const shift = +shiftArg;
const passes = {
	A: WINDOWS,
	// The first window ends `shift` s early, so every later cut sits `shift` s before the app's.
	B: { ...WINDOWS, first: WINDOWS.first - shift }
};
const out = { duration, shift, passes: {} };
let mismatches = 0;
for (const [name, settings] of Object.entries(passes)) {
	const plan = windowPlan(duration, settings);
	const tokens = [];
	const t0 = performance.now();
	for (let i = 0; i < plan.length; i++) {
		const from = Math.round(plan[i].start * 16000),
			to = Math.round(plan[i].end * 16000);
		const [lo, hi] = rs.inputFor(from, to);
		const audio = rs.range(mono.subarray(lo, hi), lo, from, to);
		const { found } = await scored(audio, plan[i].start);
		if (name === 'A' && i % 4 === 0) {
			const app = await transcribeWindow(ort, session, vocab, meta, audio, plan[i].start);
			if (JSON.stringify(app) !== JSON.stringify(found.map(([s, t]) => [s, t]))) mismatches++;
		}
		const window = plan[i];
		for (const tok of keep(plan, i, found))
			tokens.push([...tok, Math.min(tok[1] - window.start, window.end - tok[1])]);
	}
	out.passes[name] = { settings, ms: performance.now() - t0, windows: plan.length, tokens };
}
out.appMismatches = mismatches;
process.stdout.write(JSON.stringify(out));
await vite.close();
