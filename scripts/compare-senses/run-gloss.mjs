// Usage: node scripts/compare-senses/run-gloss.mjs <llama-server-binary> <model.gguf> <items.json> <out.json> [--name label]
// For words with no CC-CEDICT entry, where forced choice has nothing to choose from: the model writes a short gloss.
// Greedy decoding, thinking disabled, at most 40 tokens, stopped at the first newline. Only items with missing: true run.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { markedSentence } from './question.mjs';

const [server, model, itemsPath, outPath, ...flags] = process.argv.slice(2);
const name = flags.includes('--name') ? flags[flags.indexOf('--name') + 1] : model;
const data = JSON.parse(readFileSync(itemsPath, 'utf8'));
const items = (data.items ?? data).filter((i) => i.missing);
const port = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;

function prompt(item) {
	const user =
		`Sentence: ${markedSentence(item)}\n\n` +
		`The Chinese text ${item.word} (marked 【】) is not in the dictionary. It may be a name, a rare or new word, ` +
		`a dialect word, part of a longer word, or a speech-recognition error in the subtitles. ` +
		`In at most 12 words, say what it means in this sentence. If it is probably a misheard or mistyped word, ` +
		`start with the intended Chinese word.`;
	return `<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\nMeaning here:`;
}

const child = spawn(
	server,
	['-m', model, '-t', '4', '-c', '2048', '--port', String(port), '--no-webui'],
	{
		stdio: ['ignore', 'ignore', 'pipe']
	}
);
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
try {
	const deadline = Date.now() + 180_000;
	for (;;) {
		if (child.exitCode !== null) throw new Error('llama-server exited:\n' + stderr.slice(-2000));
		if (Date.now() > deadline) throw new Error('llama-server not healthy after 180 s');
		if (
			await fetch(`${base}/health`).then(
				(r) => r.ok,
				() => false
			)
		)
			break;
		await new Promise((r) => setTimeout(r, 250));
	}
	const rows = [];
	for (const item of items) {
		const t = performance.now();
		const res = await fetch(`${base}/completion`, {
			method: 'POST',
			body: JSON.stringify({
				prompt: prompt(item),
				n_predict: 40,
				temperature: 0,
				stop: ['\n'],
				cache_prompt: false
			})
		}).then((r) => r.json());
		rows.push({
			id: item.id,
			word: item.word,
			gloss: res.content.trim(),
			ms: performance.now() - t
		});
		console.log(item.id, '→', res.content.trim());
	}
	const rss =
		Number(/VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${child.pid}/status`, 'utf8'))[1]) * 1024;
	writeFileSync(outPath, JSON.stringify({ engine: name, peakRssBytes: rss, rows }, null, 1));
} finally {
	child.kill('SIGTERM');
}
