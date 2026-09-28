// Does the JS pipeline give sherpa-onnx's text? Compares per 30 s window against sherpa_ref.py.
//
//   node check.mjs <model.int8.onnx> <tokens.txt> <meta.json> <wav> <ref.json> [web|node]
//
// Expect identical text except at near-tied tokens (香/鲜, 自/不 on the test clips): any change of
// runtime or CPU flips those, sherpa-onnx on the phone included.
import { readFileSync } from 'node:fs';
import { transcribe, parseTokens, wavSamples } from './sensevoice.mjs';

const [model, tokFile, metaFile, wav, ref, runtime = 'web'] = process.argv.slice(2);
const ort = await import(runtime === 'node' ? 'onnxruntime-node' : 'onnxruntime-web');
if (runtime !== 'node') ort.env.wasm.numThreads = 4;
const meta = JSON.parse(readFileSync(metaFile));
const tokens = parseTokens(readFileSync(tokFile, 'utf8'));
const session = await ort.InferenceSession.create(readFileSync(model));
const samples = wavSamples(readFileSync(wav));
const want = JSON.parse(readFileSync(ref)).chunks;
let same = 0;
for (let c = 0; c < want.length; c++) {
	const got = await transcribe(
		ort,
		session,
		tokens,
		meta,
		samples.subarray(c * 480000, (c + 1) * 480000),
		c * 30
	);
	if (got.text === want[c].text) same++;
	else console.log(`window ${c}\n  sherpa: ${want[c].text}\n  js:     ${got.text}`);
}
console.log(`${same}/${want.length} windows identical`);
