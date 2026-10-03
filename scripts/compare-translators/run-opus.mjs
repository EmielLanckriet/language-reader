import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [runtimeRoot, modelRoot, output] = process.argv.slice(2);
const { translateLine } = await import(pathToFileURL(`${runtimeRoot}/app-code/opus.js`));
const { parseVocabulary } = await import(pathToFileURL(`${runtimeRoot}/tokenizer-code/unigram.js`));
const ort = await import('onnxruntime-web/wasm');
ort.env.wasm.numThreads = 1;
const corpus = JSON.parse(fs.readFileSync('scripts/compare-translators/corpus.json'));
const baseline = process.memoryUsage().rss;
const start = performance.now();
const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
const encoder = await ort.InferenceSession.create(
	fs.readFileSync(`${modelRoot}/onnx/encoder_model_quantized.onnx`),
	options
);
const decoder = await ort.InferenceSession.create(
	fs.readFileSync(`${modelRoot}/onnx/decoder_model_merged_quantized.onnx`),
	options
);
const model = {
	ort,
	encoder,
	decoder,
	vocabulary: parseVocabulary(JSON.parse(fs.readFileSync(`${modelRoot}/tokenizer.json`)))
};
const result = {
	engine: 'Reader OPUS-MT q8; ONNX Runtime Web 1.30.0 WASM, one thread, greedy',
	load_ms: performance.now() - start,
	baseline_rss: baseline,
	rows: []
};
for (let round = 0; round < 2; round++)
	for (const item of corpus) {
		const t = performance.now();
		const translation = await translateLine(item.text, model);
		result.rows.push({
			id: item.id,
			round,
			translation,
			ms: performance.now() - t,
			rss: process.memoryUsage().rss
		});
		fs.writeFileSync(output, JSON.stringify(result, null, 2));
	}
result.max_rss_kib = process.resourceUsage().maxRSS;
fs.writeFileSync(output, JSON.stringify(result, null, 2));
await encoder.release();
await decoder.release();
