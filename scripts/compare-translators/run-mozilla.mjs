import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [runtimeRoot, modelRoot, output] = process.argv.slice(2);
const packageRoot = `${runtimeRoot}/node_modules/@browsermt/bergamot-translator`;
// npm 0.4.9 ships a CommonJS worker inside an ES-module package. Supply its Node globals.
const workerPath = `${packageRoot}/worker/translator-worker.js`;
let worker = fs.readFileSync(workerPath, 'utf8');
if (!worker.startsWith('// Reader Node compatibility')) {
	const prefix = `// Reader Node compatibility\nimport {createRequire} from 'node:module';\nimport {fileURLToPath} from 'node:url';\nimport {dirname} from 'node:path';\nconst require=createRequire(import.meta.url);\nconst __dirname=dirname(fileURLToPath(import.meta.url));\nglobal.require=require; global.__dirname=__dirname; global.__filename=fileURLToPath(import.meta.url);\n`;
	fs.writeFileSync(workerPath, prefix + worker);
}
const records = JSON.parse(fs.readFileSync(`${modelRoot}/records.json`));
const files = Object.fromEntries(
	records.map((r) => [
		r.fileType,
		{ name: `${modelRoot}/${r.attachment.filename}`, expectedSha256Hash: r.attachment.hash }
	])
);
// Only local files are available to the benchmark; no translation requests leave the machine.
globalThis.fetch = async (url) =>
	new Response(url === 'local-registry' ? JSON.stringify({ zhen: files }) : fs.readFileSync(url));
const { LatencyOptimisedTranslator } = await import(pathToFileURL(`${packageRoot}/translator.js`));
const baseline = process.memoryUsage().rss;
const start = performance.now();
const translator = new LatencyOptimisedTranslator({
	registryUrl: 'local-registry',
	cacheSize: 0,
	useNativeIntGemm: false
});
const corpus = JSON.parse(fs.readFileSync('scripts/compare-translators/corpus.json'));
const result = {
	engine: `Mozilla zh-Hans-en ${records[0].version}; Bergamot npm 0.4.9 WASM, one worker`,
	baseline_rss: baseline,
	rows: []
};
try {
	await translator.translate({ from: 'zh', to: 'en', text: '你好。', html: false });
	result.load_and_warmup_ms = performance.now() - start;
	for (let round = 0; round < 2; round++)
		for (const item of corpus) {
			const t = performance.now();
			const response = await translator.translate({
				from: 'zh',
				to: 'en',
				text: item.text,
				html: false
			});
			result.rows.push({
				id: item.id,
				round,
				translation: response.target.text,
				ms: performance.now() - t,
				rss: process.memoryUsage().rss
			});
			fs.writeFileSync(output, JSON.stringify(result, null, 2));
		}
	result.max_rss_kib = process.resourceUsage().maxRSS;
	fs.writeFileSync(output, JSON.stringify(result, null, 2));
} finally {
	await translator.delete();
}
