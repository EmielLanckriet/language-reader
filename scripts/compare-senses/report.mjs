// Usage: node scripts/compare-senses/report.mjs <qwen.gguf> <laya-onnx-dir>
// Reads results/{qwen,laya}.json; writes results/manifest.json and results/comparison.html.
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { VARIANTS, markedSentence, question } from './question.mjs';

const [gguf, layaDir] = process.argv.slice(2);
const dir = new URL('./', import.meta.url);
const read = (f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
const items = read('items.json');
const byId = Object.fromEntries(items.map((i) => [i.id, i]));
const engines = { qwen: read('results/qwen.json'), laya: read('results/laya.json') };
const NAMES = { qwen: 'Qwen3-1.7B Q4', laya: 'Laya multilingual' };

const file = (p) => ({
	bytes: statSync(p).size,
	sha256: createHash('sha256').update(readFileSync(p)).digest('hex')
});
const quantile = (xs, q) => [...xs].sort((a, b) => a - b)[Math.ceil(q * xs.length) - 1];
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const top = (r) => Math.max(...r.probabilities);

function metaPicked(row, variant) {
	const item = byId[row.id];
	const q = question(item, variant);
	const k = row.pick - item.senses.length;
	return k >= 0 ? q.metaKeys[k] : null;
}

function variantSummary(run, variant) {
	const [first, second] = run.variants[variant].rounds;
	const ok = second.filter((r) => !r.error);
	const scored = ok.filter((r) => r.correct !== null);
	const right = scored.filter((r) => r.correct);
	const wrong = scored.filter((r) => !r.correct);
	const meta = {};
	for (const r of ok) {
		const m = metaPicked(r, variant);
		if (m) meta[m] = (meta[m] ?? 0) + 1;
	}
	return {
		correct: right.length,
		scored: scored.length + second.filter((r) => r.error).length,
		errors: second.filter((r) => r.error).map((r) => `${r.id}: ${r.error}`),
		meta_picks: meta,
		mean_top_probability_when_right: mean(right.map(top)),
		mean_top_probability_when_wrong: mean(wrong.map(top)),
		same_picks_between_rounds: first.every((r, i) => r.pick === second[i].pick),
		median_ms: quantile(
			ok.map((r) => r.ms),
			0.5
		),
		p95_ms: quantile(
			ok.map((r) => r.ms),
			0.95
		),
		median_input_tokens: quantile(
			ok.map((r) => r.inputTokens),
			0.5
		),
		...(run.engine.startsWith('qwen')
			? { min_letter_mass: Math.min(...ok.map((r) => r.letterMass)) }
			: {})
	};
}

function baselines(variant) {
	const qs = items
		.map((i) => question(i, variant))
		.filter((q) => q.options.length >= 2 && q.gold.length);
	return {
		scored: qs.length,
		chance: qs.reduce((s, q) => s + q.gold.length / q.options.length, 0),
		first_listed_sense: qs.filter((q) => q.gold.includes(0)).length
	};
}

const manifest = {
	date: '2026-10-03',
	host: 'AMD Ryzen 7 PRO 4750U, Linux 6.8, Node 24.20.0; 4 inference threads per engine; load average ~0.5 at start',
	items_sha256: createHash('sha256')
		.update(readFileSync(new URL('items.json', dir)))
		.digest('hex'),
	models: {
		qwen: {
			name: 'unsloth/Qwen3-1.7B-GGUF Q4_K_M (the Termux translation model)',
			runtime: 'llama.cpp server b11374, CPU',
			file: file(gguf)
		},
		laya: {
			name: 'convaiinnovations/laya multilingual/ (mmBERT-base, 322M), exported to fp32 ONNX with receptron/laya export_onnx.py at 6478649',
			runtime:
				'@receptron/laya 0.1.2 on onnxruntime-node, special tokens patched to come from tokenizer_config.json',
			file: file(path.join(layaDir, 'laya.onnx')),
			tokenizer: file(path.join(layaDir, 'tokenizer/tokenizer.json'))
		}
	},
	baselines: Object.fromEntries(VARIANTS.map((v) => [v, baselines(v)])),
	summary: Object.fromEntries(
		Object.entries(engines).map(([k, run]) => [
			k,
			{
				load_ms: run.loadMs,
				peak_process_rss_mib: run.peakRssBytes / 2 ** 20,
				...Object.fromEntries(VARIANTS.map((v) => [v, variantSummary(run, v)]))
			}
		])
	),
	method:
		'Second-round results; each call is one forward pass with probabilities over all options. Variants: forced (senses only), none (+ none fits), meta (+ none, not a whole word, and for multi-character words compositional). Items without an acceptable answer in a variant are unscored there. Gold sets were labelled by Claude and await review.'
};
writeFileSync(new URL('results/manifest.json', dir), JSON.stringify(manifest, null, 1) + '\n');

const esc = (s) =>
	String(s).replace(
		/[&<>"]/g,
		(c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]
	);
function cell(item, engine, variant) {
	const row = engines[engine].variants[variant].rounds[1].find((r) => r.id === item.id);
	if (!row) return `<td data-v="${variant}">—<small>fewer than two options</small></td>`;
	if (row.error)
		return `<td data-v="${variant}" class="bad">error<small>${esc(row.error)}</small></td>`;
	const q = question(item, variant);
	const cls = row.correct === null ? '' : row.correct ? 'ok' : 'bad';
	const mark = row.correct === null ? '·' : row.correct ? '✓' : '✗';
	return `<td data-v="${variant}" class="${cls}">${mark} ${esc(q.options[row.pick])}<small>p=${row.probabilities[row.pick].toFixed(2)}${row.correct === null ? ' · unscored' : ''}</small></td>`;
}
const rows = items.map((item) => {
	const gold = [
		...item.gold.map((g) => esc(item.senses[g])),
		...item.goldMeta.map((m) => `<em>${m}</em>`)
	].join('<br>');
	const cells = VARIANTS.flatMap((v) => [cell(item, 'qwen', v), cell(item, 'laya', v)]).join('');
	return `<tr><td><small>${esc(item.id)} · ${item.senses.length} senses</small>${esc(markedSentence(item))}</td><td>${gold}<small>${esc(item.note)}</small></td>${cells}</tr>`;
});
const s = manifest.summary;
const line = (v) =>
	`<li><b>${v}</b>: ${NAMES.qwen} ${s.qwen[v].correct}/${s.qwen[v].scored}, ${NAMES.laya} ${s.laya[v].correct}/${s.laya[v].scored}; first listed sense ${manifest.baselines[v].first_listed_sense}, chance ≈ ${manifest.baselines[v].chance.toFixed(1)}</li>`;
const heads = VARIANTS.flatMap((v) => [
	`<th data-v="${v}">${NAMES.qwen}</th>`,
	`<th data-v="${v}">${NAMES.laya}</th>`
]).join('');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sense picker comparison</title><style>body{font:16px/1.5 system-ui;margin:2rem;color:#172c38;background:#fafafa}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccd4d8;padding:12px;vertical-align:top;min-width:180px}th{background:#e7eef1;position:sticky;top:0}small{display:block;color:#567}td.ok{background:#eaf6ec}td.bad{background:#fbeceb}select{padding:8px;margin:12px}[hidden]{display:none}</style><h1>Sense picker comparison</h1><p>${items.length} words from the tariff and cooking sentences. Each model chooses among every CC-CEDICT sense of the word, plus extra options depending on the variant. <strong>Gold answers were labelled by Claude and should be reviewed.</strong></p><ul>${VARIANTS.map(line).join('')}</ul><p><a href="../../../docs/sense-picker-comparison.md">Method and findings</a> · <a href="manifest.json">Measurements and model hashes</a></p><label>Variant <select id="v">${VARIANTS.map((v) => `<option>${v}</option>`).join('')}</select></label><div style="overflow:auto"><table><thead><tr><th>Sentence</th><th>Gold</th>${heads}</tr></thead><tbody>${rows.join('')}</tbody></table></div><script>const show=()=>document.querySelectorAll('[data-v]').forEach(e=>e.hidden=e.dataset.v!==v.value);v.onchange=show;show()</script>`;
writeFileSync(new URL('results/comparison.html', dir), html);
console.log(JSON.stringify({ baselines: manifest.baselines, summary: manifest.summary }, null, 1));
