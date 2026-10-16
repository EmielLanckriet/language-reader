// Issue #14, faster kernels: one SenseVoice window, single thread, through
//   ort-web     onnxruntime-web 1.30.0 (WebAssembly, what Reader runs) with sensevoice.mjs's features
//   sherpa-wasm sherpa-onnx 1.13.8's own WebAssembly build (npm `sherpa-onnx`), features included
//   ort-node    onnxruntime-node (native), for reference
// Three runs each after one warm-up; prints the median and the text.
//   node kernels.mjs <model dir> <16 kHz mono wav> <dir holding node_modules/sherpa-onnx> [seconds...]
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const here = new URL('../', import.meta.url);
const { transcribe, parseTokens, wavSamples } = await import(new URL('sensevoice.mjs', here));
const [M, wav, sherpaDir, ...lengths] = process.argv.slice(2);
const meta = JSON.parse(
	readFileSync(new URL('../../../../src/lib/speech/sense-voice-meta.json', import.meta.url))
);
const tokens = parseTokens(readFileSync(`${M}/tokens.txt`, 'utf8'));
const all = wavSamples(readFileSync(wav));
const windows = (lengths.length ? lengths : ['30', '10']).map(Number);
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];

async function time(run) {
	await run();
	const ms = [];
	let text;
	for (let i = 0; i < 3; i++) {
		const t = performance.now();
		text = await run();
		ms.push(performance.now() - t);
	}
	return { ms: median(ms), all: ms.map(Math.round), text };
}

const results = {};
for (const runtime of ['ort-web', 'ort-node']) {
	const ort = await import(runtime === 'ort-web' ? 'onnxruntime-web' : 'onnxruntime-node');
	if (runtime === 'ort-web') ort.env.wasm.numThreads = 1;
	const session = await ort.InferenceSession.create(
		readFileSync(`${M}/model.int8.onnx`),
		runtime === 'ort-node' ? { intraOpNumThreads: 1, interOpNumThreads: 1 } : {}
	);
	for (const s of windows) {
		const samples = all.subarray(0, s * 16000);
		results[`${runtime} ${s}s`] = await time(
			async () => (await transcribe(ort, session, tokens, meta, samples)).text
		);
	}
}
const sherpa = createRequire(join(sherpaDir, 'package.json'))('sherpa-onnx');
const rec = sherpa.createOfflineRecognizer({
	featConfig: { sampleRate: 16000, featureDim: 80 },
	modelConfig: {
		senseVoice: { model: `${M}/model.int8.onnx`, language: 'zh', useInverseTextNormalization: 0 },
		tokens: `${M}/tokens.txt`,
		numThreads: 1,
		provider: 'cpu',
		debug: 0
	}
});
for (const s of windows) {
	const samples = all.slice(0, s * 16000);
	results[`sherpa-wasm ${s}s`] = await time(() => {
		const stream = rec.createStream();
		stream.acceptWaveform(16000, samples);
		rec.decode(stream);
		const text = rec.getResult(stream).text;
		stream.free();
		return text;
	});
}
for (const [k, v] of Object.entries(results))
	console.log(
		`${k.padEnd(16)} ${(v.ms / 1000).toFixed(2)} s  ${JSON.stringify(v.all)}  ${v.text.slice(0, 40)}`
	);
