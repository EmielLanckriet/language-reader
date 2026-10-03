// Usage: node scripts/compare-senses/run-qwen.mjs <llama-server-binary> <model.gguf> <out.json>
//        [--name label] [--variants forced,none,meta] [--trim] [--sentence-first]
// --sentence-first puts the unmarked sentence at the start of the prompt and keeps llama.cpp's prompt cache,
// so consecutive words from one sentence reuse its prefix; items are then ordered by sentence.
// One forward pass per item: the probability of each option letter as the first answer token,
// renormalized over the valid letters. Nothing is generated beyond that token.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import {
	LETTERS,
	VARIANTS,
	instruction,
	markedSentence,
	question,
	summarize
} from './question.mjs';

const [server, model, outPath, ...flags] = process.argv.slice(2);
const flag = (f) => flags.includes(f);
const arg = (f, d) => (flags.includes(f) ? flags[flags.indexOf(f) + 1] : d);
const name = arg('--name', 'qwen3-1.7b-q4');
const variantList = arg('--variants', VARIANTS.join(',')).split(',');
const trim = flag('--trim');
const sentenceFirst = flag('--sentence-first');
const items = JSON.parse(readFileSync(new URL('./items.json', import.meta.url), 'utf8'));
if (sentenceFirst) items.sort((a, b) => a.source.localeCompare(b.source));
const port = 18000 + Math.floor(Math.random() * 1000);
const base = `http://127.0.0.1:${port}`;

function prompt(item, q) {
	const options = q.options.map((o, i) => `${LETTERS[i]}. ${o}`).join('\n');
	const marked = markedSentence(item);
	const at = marked.indexOf('【');
	const user = sentenceFirst
		? `Sentence: ${item.sentence}\n\nWhich dictionary sense of the Chinese word ${item.word} (marked 【】 in "…${marked.slice(Math.max(0, at - 4), at + item.word.length + 6)}…") is meant in this sentence?\n\n${options}\n\nAnswer with the letter only.`
		: `Sentence: ${marked}\n\n${instruction(item)}\n\n${options}\n\nAnswer with the letter only.`;
	// Qwen3 chat template with thinking disabled (the empty think block). Without the "Answer:" prefill the first
	// token is "The" with probability ~1 and the letters hold almost no mass (measured 2026-10-03).
	return `<|im_start|>user\n${user}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\nAnswer:`;
}

const child = spawn(
	server,
	['-m', model, '-t', '4', '-c', '2048', '--port', String(port), '--no-webui'],
	{ stdio: ['ignore', 'ignore', 'pipe'] }
);
let stderr = '';
child.stderr.on('data', (d) => (stderr += d));
const peakRss = () =>
	Number(/VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${child.pid}/status`, 'utf8'))[1]) * 1024;

try {
	let t = performance.now();
	const deadline = Date.now() + 120_000;
	for (;;) {
		if (child.exitCode !== null) throw new Error('llama-server exited:\n' + stderr.slice(-2000));
		if (Date.now() > deadline) throw new Error('llama-server not healthy after 120 s');
		const ok = await fetch(`${base}/health`).then(
			(r) => r.ok,
			() => false
		);
		if (ok) break;
		await new Promise((r) => setTimeout(r, 250));
	}
	const loadMs = performance.now() - t;

	const variants = {};
	for (const variant of variantList) {
		const rounds = [];
		for (let round = 0; round < 2; round++) {
			const rows = [];
			for (const item of items) {
				const q = question(item, variant, { trim });
				if (q.options.length < 2) continue;
				t = performance.now();
				const res = await fetch(`${base}/completion`, {
					method: 'POST',
					body: JSON.stringify({
						prompt: prompt(item, q),
						n_predict: 1,
						n_probs: 100,
						temperature: 0,
						cache_prompt: sentenceFirst,
						post_sampling_probs: false
					})
				}).then((r) => r.json());
				const ms = performance.now() - t;
				const top = res.completion_probabilities[0].top_logprobs;
				const raw = q.options.map((_, i) =>
					top
						.filter((x) => x.token.trim() === LETTERS[i])
						.reduce((s, x) => s + Math.exp(x.logprob), 0)
				);
				const letterMass = raw.reduce((a, b) => a + b, 0);
				rows.push({
					...summarize(
						item,
						q,
						raw.map((p) => p / letterMass)
					),
					ms,
					promptMs: res.timings.prompt_ms,
					inputTokens: res.timings.prompt_n,
					letterMass
				});
			}
			rounds.push(rows);
		}
		variants[variant] = { rounds };
	}
	writeFileSync(
		outPath,
		JSON.stringify(
			{ engine: name, trim, sentenceFirst, loadMs, peakRssBytes: peakRss(), variants },
			null,
			1
		)
	);
	console.log('wrote', outPath);
} finally {
	child.kill('SIGTERM');
}
