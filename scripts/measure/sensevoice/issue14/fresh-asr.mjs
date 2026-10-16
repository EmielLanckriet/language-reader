// Issue #14: does decoding every window with its own fresh AAC decoder (a few frames early) cost
// accuracy, against one decoder running from frame 0? Both decoded with FDK-AAC (fdk/fdkrange),
// then the app's resampler, window plan and SenseVoice pipeline. Writes, per excerpt,
// <out>/passes-<name>.json with pass A = one decoder from frame 0, B = fresh decoder per window,
// for score.py.
//   node fresh-asr.mjs <model dir> <film.adts> <fdkrange> <excerpt list> <out dir> [preroll frames]
import * as ort from 'onnxruntime-node';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'vite';

const here = new URL('../', import.meta.url);
const { parseTokens } = await import(new URL('sensevoice.mjs', here));
const [M, adts, exe, listing, out, prerollArg = '8'] = process.argv.slice(2);
const PREROLL = +prerollArg;
const vite = await createServer({
	configFile: false,
	root: new URL('../../../..', import.meta.url).pathname,
	server: { middlewareMode: true },
	appType: 'custom',
	logLevel: 'error'
});
const load = (p) => vite.ssrLoadModule(p);
const { transcribeWindow } = await load('/src/lib/speech/pipeline.ts');
const { windowPlan, keep } = await load('/src/lib/speech/windows.ts');
const { Resampler, downmix } = await load('/src/lib/speech/resample.ts');
const meta = JSON.parse(
	readFileSync(new URL('../../../../src/lib/speech/sense-voice-meta.json', import.meta.url))
);
const vocab = parseTokens(readFileSync(`${M}/tokens.txt`, 'utf8'));
const session = await ort.InferenceSession.create(readFileSync(`${M}/model.int8.onnx`), {
	intraOpNumThreads: 4
});
const FRAME = 1024;

/** Mono float input samples of frames [keep, to), decoded from frame `from` by a fresh decoder. */
function decode(from, keepFrame, to) {
	const b = execFileSync(exe, [adts, String(from), String(keepFrame), String(to), '-1'], {
		maxBuffer: 1 << 30
	});
	const s = new Int16Array(b.buffer, b.byteOffset, b.length / 2);
	const L = new Float32Array(s.length / 2),
		R = new Float32Array(s.length / 2);
	for (let i = 0; i < L.length; i++) {
		L[i] = s[2 * i] / 32768;
		R[i] = s[2 * i + 1] / 32768;
	}
	return downmix([L, R]);
}

for (const line of readFileSync(listing, 'utf8').trim().split('\n')) {
	const [name, start, length] = line.split(/\s+/);
	// The excerpt as a recording of its own, starting on a frame boundary.
	const k0 = Math.floor((+start * 44100) / FRAME);
	const frames = Math.floor((+length * 44100) / FRAME);
	const rs = new Resampler(44100, frames * FRAME);
	const plan = windowPlan(rs.outputLength / 16000);
	const whole = decode(0, k0, k0 + frames);
	const passes = { A: [], B: [] };
	let differing = 0;
	for (let i = 0; i < plan.length; i++) {
		const from = Math.round(plan[i].start * 16000),
			to = Math.round(plan[i].end * 16000);
		const [lo, hi] = rs.inputFor(from, to);
		const f0 = Math.floor(lo / FRAME),
			f1 = Math.ceil(hi / FRAME);
		const own = decode(k0 + Math.max(0, f0 - PREROLL), k0 + f0, k0 + f1);
		const a = rs.range(whole.subarray(lo, hi), lo, from, to);
		const b = rs.range(own.subarray(lo - f0 * FRAME, hi - f0 * FRAME), lo, from, to);
		if (a.some((v, j) => v !== b[j])) differing++;
		for (const [pass, audio] of [
			['A', a],
			['B', b]
		]) {
			const found = await transcribeWindow(ort, session, vocab, meta, audio, plan[i].start);
			for (const [text, t] of keep(plan, i, found)) passes[pass].push([text, t, 1, 0, 1]);
		}
	}
	const changed = passes.A.map((t) => t[0]).join('') !== passes.B.map((t) => t[0]).join('');
	console.log(
		`${name}: ${plan.length} windows, ${differing} with different samples, text ${changed ? 'differs' : 'identical'}`
	);
	writeFileSync(
		`${out}/passes-${name}.json`,
		JSON.stringify({
			shift: 0,
			preroll: PREROLL,
			passes: { A: { tokens: passes.A }, B: { tokens: passes.B } }
		})
	);
}
await vite.close();
