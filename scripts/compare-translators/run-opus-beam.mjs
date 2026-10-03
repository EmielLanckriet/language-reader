// Optional quality-only control: same q8 weights, library decoding with three beams.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const [transformersRoot, output] = process.argv.slice(2);
const { pipeline, env } = await import(pathToFileURL(`${transformersRoot}/src/transformers.js`));
env.allowRemoteModels = false;
env.cacheDir = `${transformersRoot}/.cache`;
const translator = await pipeline('translation', 'Xenova/opus-mt-zh-en', {
	dtype: 'q8',
	device: 'cpu',
	session_options: { intraOpNumThreads: 1, interOpNumThreads: 1 }
});
const rows = [];
for (const item of JSON.parse(fs.readFileSync('scripts/compare-translators/corpus.json'))) {
	const start = performance.now();
	const out = await translator(item.text, { num_beams: 3, do_sample: false, max_new_tokens: 160 });
	rows.push({ id: item.id, translation: out[0].translation_text, ms: performance.now() - start });
	fs.writeFileSync(
		output,
		JSON.stringify(
			{
				engine:
					'Transformers.js 4.3.0 OPUS q8, beam 3, native CPU one thread (quality control only)',
				rows
			},
			null,
			2
		)
	);
}
await translator.dispose();
