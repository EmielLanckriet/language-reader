/**
 * Slice 2's analyzer: real Chinese word segmentation, using the browser's own ICU.
 *
 * The third implementation of the language-provider seam, and the first whose behaviour is not
 * ours. `Intl.Segmenter` costs zero bytes — measured against an application that ships 1.40 MB,
 * where every alternative candidate needs two to ten times that in dictionaries — and it is
 * correct on ordinary text.
 *
 * It is also wrong in a characteristic way, measured rather than assumed (research.md R1): it
 * splits 自行车 into 自行 + 车, reads 三个人 as 三 + 个人, splits the name 玛丽亚, and merges 我在
 * into a non-word. It gets the hard context-dependent case right (结婚的和尚未结婚的人 does not
 * become 和尚) and it keeps 花钱 whole. Good enough to ship; not the end state. What replaces it is
 * decided by measurement on the reader's own material, not by argument.
 */

import type { Analyzer, AnalyzedToken } from './types';
import { codePointIndexMap, codePointLength } from '../domain/offsets';
import { splitIntoUnits } from './units';
import { CHINESE_UNIT_DELIMITERS } from './delimiters';
import { PROBE, fingerprintOf } from './fingerprint';

function segmenter(): Intl.Segmenter {
	return new Intl.Segmenter('zh', { granularity: 'word' });
}

/**
 * Whether a span is something the reader could study.
 *
 * **Not** `Intl.Segmenter`'s `isWordLike`, and the difference matters. The platform is honest about
 * what it means — `Python` and `3.14` come back word-like — but they are not Chinese vocabulary,
 * and a word list polluted with them cannot be studied. `isWord` keeps slice 0's meaning: Han
 * script. Passing `isWordLike` through is the plausible-looking simplification this comment exists
 * to prevent (contracts/analyzer.md obligation 10).
 */
function isStudiable(surface: string): boolean {
	return /\p{Script=Han}/u.test(surface);
}

/**
 * Computed once, at module load, by segmenting a fixed probe and hashing the result.
 *
 * This is the version recorded on every document this analyzer stamps (ADR-0011). It cannot be a
 * constant: the behaviour belongs to the browser's ICU, which differs between devices and changes
 * with updates, and a constant would describe two different tokenisations identically.
 */
const VERSION = fingerprintOf([...segmenter().segment(PROBE)]);

export const chineseSegmenter: Analyzer = {
	name: 'intl-segmenter-zh',
	version: VERSION,
	language: 'zh',
	unitDelimiters: CHINESE_UNIT_DELIMITERS,

	analyze(text: string): Promise<AnalyzedToken[]> {
		const tokens: AnalyzedToken[] = [];
		const segment = segmenter();

		for (const unit of splitIntoUnits(text, CHINESE_UNIT_DELIMITERS)) {
			// **The dangerous conversion.** Intl.Segmenter reports `index` in UTF-16 code units;
			// every offset stored by this application is a character offset. On text made only of
			// BMP characters the two are identical, so omitting this passes every ordinary test and
			// then mis-anchors offsets the first time a character outside the BMP appears —
			// including offsets already recorded against marks, which are earned data. Measured, on
			// 𠮷野家很好: the platform reports 0, 2, 4 for a string of five characters.
			const toCharacterIndex = codePointIndexMap(unit.text);
			const unitLength = codePointLength(unit.text);

			const reported = [...segment.segment(unit.text)];
			for (let i = 0; i < reported.length; i++) {
				const start = toCharacterIndex[reported[i].index];
				const end = i + 1 < reported.length ? toCharacterIndex[reported[i + 1].index] : unitLength;

				tokens.push({
					start: unit.start + start,
					end: unit.start + end,
					isWord: isStudiable(reported[i].segment)
				});
			}
		}

		return Promise.resolve(tokens);
	},

	// Chinese has no inflection to strip, so identity — the same rule slice 0 stated. It is here
	// rather than assumed by storage because that is the point of the seam: Dutch will return a
	// dictionary form, and this is the only line that changes.
	lexemeKey(surface: string): string {
		return surface;
	}
};
