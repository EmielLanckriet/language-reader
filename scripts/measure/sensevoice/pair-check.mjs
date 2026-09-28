// Transcript differences between two 16 kHz WAVs of the same audio (e.g. two resamplers).
import * as ort from 'onnxruntime-node';
import { readFileSync } from 'node:fs';
import { transcribeLong, parseTokens, wavSamples } from './sensevoice.mjs';
const [M, a, b] = process.argv.slice(2);
const meta = JSON.parse(readFileSync(`${M}/meta.json`)),
	tokens = parseTokens(readFileSync(`${M}/tokens.txt`, 'utf8'));
const s = await ort.InferenceSession.create(readFileSync(`${M}/model.int8.onnx`));
const A = (await transcribeLong(ort, s, tokens, meta, wavSamples(readFileSync(a)))).text;
const B = (await transcribeLong(ort, s, tokens, meta, wavSamples(readFileSync(b)))).text;
console.log(JSON.stringify({ A, B }));
