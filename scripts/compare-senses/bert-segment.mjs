// Usage: node scripts/compare-senses/bert-segment.mjs <backup.json> <tokens.json>
// Segment every library document in a Reader backup with the segmenter harness's mirror of the shipped BERT tagger,
// then apply the reader's corrections (latest last). Output: {document id: [[start, end, isWord]...]} in code points.
// It holds the reader's library, so write it outside the repository. Single-threaded WASM: about 12 minutes for 32 documents.
import { readFileSync, writeFileSync } from 'node:fs';
import { prepare } from '../compare-segmenters/candidates/bert-ws.mjs';
const [backupPath, outPath] = process.argv.slice(2);
const b = JSON.parse(readFileSync(backupPath, 'utf8'));
const DELIM = new Set(['\n', '\r', '。', '！', '？', '…', '；']);
const bert = await prepare();
const out = {};
for (const d of b.documents) {
	const chars = [...d.rawContent];
	const units = [];
	let start = 0,
		cur = [];
	for (const c of chars) {
		cur.push(c);
		if (DELIM.has(c)) {
			units.push([start, cur.join('')]);
			start += cur.length;
			cur = [];
		}
	}
	if (cur.length) units.push([start, cur.join('')]);
	let toks = [];
	for (const [us, ut] of units)
		for (const t of await bert.segmentUnit(ut)) toks.push([us + t.start, us + t.end, t.isWord]);
	const corr = b.corrections
		.filter((c) => c.documentId === d.id)
		.sort((a, z) => a.madeAt.localeCompare(z.madeAt));
	for (const c of corr) {
		const inside = toks.filter((t) => t[0] >= c.from && t[1] <= c.to);
		const covered =
			inside.length && inside[0][0] === c.from && inside[inside.length - 1][1] === c.to;
		if (!covered) {
			console.error('correction not on token boundaries', d.id, c.from, c.to, c.form);
			continue;
		}
		let at = c.from;
		const repl = c.parts.map((p) => {
			const L = [...p.surface].length;
			const t = [at, at + L, true];
			at += L;
			return t;
		});
		toks = [...toks.filter((t) => t[1] <= c.from), ...repl, ...toks.filter((t) => t[0] >= c.to)];
	}
	out[d.id] = toks;
}
writeFileSync(outPath, JSON.stringify(out));
console.log('segmented', Object.keys(out).length, 'documents');
