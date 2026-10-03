// Usage: node scripts/compare-pinyin/run-pinyin-pro.mjs <sentences.txt> <out.json>
// One sentence per line, the polyphone marked ▁X▁ as in CPP. Uses Reader's own pinyin-pro and the same
// whole-text call as src/lib/analyzer/pronounce.ts, with numbered tones for comparison.
import { readFileSync, writeFileSync } from 'node:fs';
import { pinyin } from 'pinyin-pro';

const [input, outPath] = process.argv.slice(2);
const lines = readFileSync(input, 'utf8').split('\n').filter(Boolean);
const t = performance.now();
const predictions = lines.map((line) => {
	const at = [...line].indexOf('▁');
	const text = line.replaceAll('▁', '');
	return pinyin(text, { type: 'all', toneType: 'num' })[at].pinyin;
});
const ms = performance.now() - t;
writeFileSync(outPath, JSON.stringify({ engine: 'pinyin-pro', ms, predictions }));
console.log('wrote', outPath, Math.round(ms), 'ms');
