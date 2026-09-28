import * as ort from 'onnxruntime-node';
import { readFileSync } from 'node:fs';
import { transcribeLong, parseTokens, wavSamples } from './sensevoice.mjs';
import { toSpeech } from './resample.mjs';
const [M, ref16, raw44] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(`${M}/meta.json`)),
	tokens = parseTokens(readFileSync(`${M}/tokens.txt`, 'utf8'));
const s = await ort.InferenceSession.create(readFileSync(`${M}/model.int8.onnx`));
const a = wavSamples(readFileSync(ref16));
const b = readFileSync(raw44),
	f = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
const L = new Float32Array(f.length / 2),
	R = new Float32Array(f.length / 2);
for (let i = 0; i < L.length; i++) {
	L[i] = f[2 * i];
	R[i] = f[2 * i + 1];
}
let t = performance.now();
const mine = toSpeech([L, R], 44100);
const rsMs = performance.now() - t;
let d = 0;
const n = Math.min(a.length, mine.length);
for (let i = 0; i < n; i++) d += (a[i] - mine[i]) ** 2;
let p = 0;
for (let i = 0; i < n; i++) p += a[i] ** 2;
const A = (await transcribeLong(ort, s, tokens, meta, a, {})).text,
	B = (await transcribeLong(ort, s, tokens, meta, mine, {})).text;
console.log(
	JSON.stringify({
		samples: [a.length, mine.length],
		resampleMs: Math.round(rsMs),
		snrDb: +(10 * Math.log10(p / d)).toFixed(1),
		same: A === B,
		A,
		B
	})
);
