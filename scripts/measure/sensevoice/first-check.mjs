// Does a short first window cost accuracy? Transcript with a `first`-second first window against
// 30 s windows throughout, both with the 2 s overlap.
//   node first-check.mjs <model dir> <16 kHz wav> [first seconds]
import * as ort from 'onnxruntime-node';
import { readFileSync } from 'node:fs';
import { transcribeLong, transcribe, parseTokens, wavSamples } from './sensevoice.mjs';
const [M, wav, first = '10'] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(`${M}/meta.json`)),
	tokens = parseTokens(readFileSync(`${M}/tokens.txt`, 'utf8'));
const s = await ort.InferenceSession.create(readFileSync(`${M}/model.int8.onnx`));
const a = wavSamples(readFileSync(wav));
const A = (await transcribeLong(ort, s, tokens, meta, a, {})).text;
const B = (await transcribeLong(ort, s, tokens, meta, a, { first: Number(first) })).text;
let t = performance.now();
await transcribe(ort, s, tokens, meta, a.subarray(0, Number(first) * 16000));
const firstMs = performance.now() - t;
t = performance.now();
await transcribe(ort, s, tokens, meta, a.subarray(0, 30 * 16000));
const fullMs = performance.now() - t;
console.log(JSON.stringify({ firstMs: Math.round(firstMs), fullMs: Math.round(fullMs), A, B }));
