// Usage: node scripts/compare-senses/run-laya.mjs <bench-dir-with-@receptron/laya> <onnx-bundle-dir> <out.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
	LETTERS,
	VARIANTS,
	instruction,
	markedSentence,
	question,
	summarize
} from './question.mjs';

const [benchDir, modelDir, outPath] = process.argv.slice(2);
const entry = createRequire(path.join(path.resolve(benchDir), 'x.js')).resolve('@receptron/laya');
const { Laya } = await import(pathToFileURL(entry).href);
const items = JSON.parse(readFileSync(new URL('./items.json', import.meta.url), 'utf8'));

const peakRss = () =>
	Number(/VmHWM:\s+(\d+)/.exec(readFileSync('/proc/self/status', 'utf8'))[1]) * 1024;

let t = performance.now();
const laya = await Laya.load({
	modelDir,
	sessionOptions: { intraOpNumThreads: 4, interOpNumThreads: 1 }
});
const loadMs = performance.now() - t;

const variants = {};
for (const variant of VARIANTS) {
	const rounds = [];
	for (let round = 0; round < 2; round++) {
		const rows = [];
		for (const item of items) {
			const q = question(item, variant);
			if (q.options.length < 2) continue;
			const criteria = Object.fromEntries(q.options.map((o, i) => [LETTERS[i], o]));
			const state = { sentence: markedSentence(item), word: item.word };
			t = performance.now();
			let result;
			try {
				result = await laya.systemOne(state, {
					sense: { type: 'choice', instructions: instruction(item), criteria }
				});
			} catch (error) {
				rows.push({ id: item.id, error: String(error.message ?? error), correct: false });
				continue;
			}
			const ms = performance.now() - t;
			const p = result.answers.sense.probabilities;
			rows.push({
				...summarize(
					item,
					q,
					q.options.map((_, i) => p[LETTERS[i]])
				),
				ms,
				inputTokens: result.usage.input_tokens
			});
		}
		rounds.push(rows);
	}
	variants[variant] = { rounds };
}
await laya.close();

writeFileSync(
	outPath,
	JSON.stringify(
		{ engine: 'laya-multilingual', loadMs, peakRssBytes: peakRss(), variants },
		null,
		1
	)
);
console.log('wrote', outPath);
