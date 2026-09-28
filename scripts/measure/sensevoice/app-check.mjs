// Does the app's port (src/lib/speech/) give exactly the measured pipeline's text? Spec 008 T008.
//
//   node app-check.mjs <model dir: model.int8.onnx, tokens.txt, meta.json> <f32 44.1 kHz stereo> …
//
// Each input is raw float32 interleaved stereo at 44.1 kHz (`ffmpeg -i media.mp4 -vn -f f32le -ac 2
// -ar 44100 x.f32`). The app's side resamples window by window with `Resampler.range`, as the
// worker will; the measured side resamples the whole file with `toSpeech`. Both then run the same
// window plan on onnxruntime-node, so any difference is the port's.
import * as ort from 'onnxruntime-node';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';
import { toSpeech } from './resample.mjs';
import { transcribeLong, parseTokens } from './sensevoice.mjs';

const [M, ...inputs] = process.argv.slice(2);
const vite = await createServer({
	configFile: false,
	root: new URL('../../..', import.meta.url).pathname,
	server: { middlewareMode: true },
	appType: 'custom',
	logLevel: 'error'
});
const { transcribeWindow } = await vite.ssrLoadModule('/src/lib/speech/pipeline.ts');
const { windowPlan, keep, WINDOWS } = await vite.ssrLoadModule('/src/lib/speech/windows.ts');
const { Resampler, downmix } = await vite.ssrLoadModule('/src/lib/speech/resample.ts');
const meta = JSON.parse(
	readFileSync(new URL('../../../src/lib/speech/sense-voice-meta.json', import.meta.url))
);
const tokens = parseTokens(readFileSync(`${M}/tokens.txt`, 'utf8'));
const session = await ort.InferenceSession.create(readFileSync(`${M}/model.int8.onnx`));
let failed = false;

for (const input of inputs) {
	const b = readFileSync(input);
	const f = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
	const L = new Float32Array(f.length / 2),
		R = new Float32Array(f.length / 2);
	for (let i = 0; i < L.length; i++) {
		L[i] = f[2 * i];
		R[i] = f[2 * i + 1];
	}

	const measured = await transcribeLong(ort, session, tokens, meta, toSpeech([L, R], 44100), {
		first: WINDOWS.first
	});

	const mono = downmix([L, R]);
	const rs = new Resampler(44100, mono.length);
	const plan = windowPlan(rs.outputLength / 16000);
	const app = [];
	for (let i = 0; i < plan.length; i++) {
		const from = Math.round(plan[i].start * 16000),
			to = Math.round(plan[i].end * 16000);
		const [lo, hi] = rs.inputFor(from, to);
		const samples = rs.range(mono.subarray(lo, hi), lo, from, to);
		app.push(
			...keep(plan, i, await transcribeWindow(ort, session, tokens, meta, samples, plan[i].start))
		);
	}
	const text = app.map(([t]) => t).join('');
	const same = text === measured.text;
	const timesSame = same && app.every(([, t], i) => Math.abs(t - measured.ts[i]) < 1e-9);
	console.log(
		`${input}: ${same ? 'identical text' : 'TEXT DIFFERS'}, ${timesSame ? 'identical times' : 'times differ'} (${text.length} chars)`
	);
	if (!same) console.log(`  measured: ${measured.text}\n  app:      ${text}`);
	failed ||= !same || !timesSame;
}
await vite.close();
process.exit(failed ? 1 : 0);
