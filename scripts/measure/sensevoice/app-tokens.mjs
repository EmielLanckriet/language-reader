// The app's pipeline (src/lib/speech/) over a recording, as app-vtt.mjs, printing the kept tokens
// as JSON instead of WebVTT; window settings optional, so passes with shifted windows compare.
//   node app-tokens.mjs <model dir> <f32 44.1 kHz stereo> [first length overlap] > tokens.json
import * as ort from 'onnxruntime-node';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { parseTokens } from './sensevoice.mjs';

const [M, input, ...setting] = process.argv.slice(2);
const vite = await createServer({
	configFile: false,
	root: new URL('../../..', import.meta.url).pathname,
	server: { middlewareMode: true },
	appType: 'custom',
	logLevel: 'error'
});
const load = (p) => vite.ssrLoadModule(p);
const { transcribeWindow } = await load('/src/lib/speech/pipeline.ts');
const { windowPlan, keep, WINDOWS } = await load('/src/lib/speech/windows.ts');
const { Resampler, downmix } = await load('/src/lib/speech/resample.ts');
const settings = setting.length
	? { first: +setting[0], length: +setting[1], overlap: +setting[2] }
	: WINDOWS;
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
const plan = windowPlan(rs.outputLength / 16000, settings);
const all = [];
for (let i = 0; i < plan.length; i++) {
	const from = Math.round(plan[i].start * 16000),
		to = Math.round(plan[i].end * 16000);
	const [lo, hi] = rs.inputFor(from, to);
	const found = await transcribeWindow(
		ort,
		session,
		tokens,
		meta,
		rs.range(mono.subarray(lo, hi), lo, from, to),
		plan[i].start
	);
	all.push(...keep(plan, i, found));
}
process.stdout.write(JSON.stringify({ settings, plan, tokens: all }));
await vite.close();
