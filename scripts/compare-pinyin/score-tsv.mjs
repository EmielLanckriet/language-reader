// Usage: node scripts/compare-pinyin/score-tsv.mjs <file.tsv>...  (QUIET=1 hides the misses)
// Scores Reader's pinyin, the same call as src/lib/analyzer/pronounce.ts including its phrase
// table, on sentences with the heteronym marked ▁X▁, a tab and the expected numbered reading.
// RAW=1 scores pinyin-pro without the table.
import { readFileSync } from 'node:fs';
import { pinyin } from 'pinyin-pro';

if (!process.env.RAW) {
	const { applyPhraseTable } = await import('../../src/lib/analyzer/pinyin-phrases.ts');
	applyPhraseTable();
}
for (const file of process.argv.slice(2)) {
	const rows = readFileSync(file, 'utf8')
		.trim()
		.split('\n')
		.map((l) => l.split('\t'));
	let ok = 0;
	for (const [marked, gold, note] of rows) {
		const at = [...marked].indexOf('▁');
		const text = marked.replaceAll('▁', '');
		const got = pinyin(text, { type: 'all', toneType: 'num' })[at].pinyin.replace(/0$/, '5');
		if (got === gold) ok++;
		else if (!process.env.QUIET)
			console.log('  miss', text, [...text][at], got, '≠', gold, note ?? '');
	}
	console.log(file.split('/').pop(), `${ok}/${rows.length}`);
}
