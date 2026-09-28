// The app's pipeline (src/lib/speech/) over a whole recording, window by window as the worker
// does, written as WebVTT: a laptop baseline to set a phone transcript beside.
//   node app-vtt.mjs <model dir> <f32 44.1 kHz stereo> > out.vtt
import * as ort from 'onnxruntime-node';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { parseTokens } from './sensevoice.mjs';

const [M, input] = process.argv.slice(2);
const vite = await createServer({
	configFile: false,
	root: new URL('../../..', import.meta.url).pathname,
	server: { middlewareMode: true },
	appType: 'custom',
	logLevel: 'error'
});
const load = (p) => vite.ssrLoadModule(p);
const { transcribeWindow } = await load('/src/lib/speech/pipeline.ts');
const { windowPlan, keep } = await load('/src/lib/speech/windows.ts');
const { Resampler, downmix } = await load('/src/lib/speech/resample.ts');
const { lines, toVtt } = await load('/src/lib/speech/lines.ts');
const meta = JSON.parse(
	readFileSync(new URL('../../../src/lib/speech/sense-voice-meta.json', import.meta.url))
);
const tokens = parseTokens(readFileSync(`${M}/tokens.txt`, 'utf8'));
const session = await ort.InferenceSession.create(readFileSync(`${M}/model.int8.onnx`));
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
const plan = windowPlan(rs.outputLength / 16000);
const all = [];
const t0 = performance.now();
for (let i = 0; i < plan.length; i++) {
	const from = Math.round(plan[i].start * 16000),
		to = Math.round(plan[i].end * 16000);
	const [lo, hi] = rs.inputFor(from, to);
	all.push(
		...keep(
			plan,
			i,
			await transcribeWindow(
				ort,
				session,
				tokens,
				meta,
				rs.range(mono.subarray(lo, hi), lo, from, to),
				plan[i].start
			)
		)
	);
}
console.error(`${plan.length} windows in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
process.stdout.write(toVtt(lines(all)));
await vite.close();
