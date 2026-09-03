/**
 * Segmenting Chinese against a word list the application carries itself.
 *
 * This exists because the platform cannot be relied on. `Intl.Segmenter` splits Chinese into words
 * only where the browser embeds ICU's CJK dictionary data, and Chrome on the reader's Android
 * phone does not: it returns one token per character, reports no error, and offers no way to ask
 * in advance or to supply a dictionary (research.md R11). The zero-cost analyzer therefore does not
 * work on the one device the constitution treats as the oracle, so the reader ships its own words.
 *
 * The word list is CC-CEDICT's headwords and nothing else — 120,176 entries, 1.00 MB on disk and
 * 0.43 MB over the wire. Definitions are four times that and segmentation does not need them.
 *
 * **Greedy longest match**, forward. At each position, take the longest word in the list that
 * starts there; if none does, take the single character. It is not the best algorithm available —
 * a frequency-weighted maximum-probability path resolves ambiguities that this cannot, and the
 * register says so — but it is the one whose behaviour a reader of this file can predict, and it
 * already gets the cases the platform got wrong: 自行车 whole rather than 自行 + 车, 我在 as two
 * words rather than one non-word. Whether frequency weighting is worth a second data file is a
 * measurement, and the harness in scripts/compare-segmenters/ is where it gets made.
 */

import type { Analyzer, AnalyzedToken } from './types';
import { codePointsOf } from '../domain/offsets';
import { splitIntoUnits } from './units';
import { CHINESE_UNIT_DELIMITERS } from './delimiters';
import { WORDLIST_VERSION } from './wordlist-version';

/** Longest headword the list contains, so matching never looks further than it must. */
const LONGEST_WORD = 8;

export interface WordList {
	has(word: string): boolean;
}

function isHan(character: string): boolean {
	return /\p{Script=Han}/u.test(character);
}

/**
 * Build an analyzer over a word list it loads when first asked.
 *
 * Takes a loader rather than a list, for two reasons that both matter. The list is a megabyte
 * fetched over HTTP, so nothing should wait for it until a document is actually being analysed —
 * and the version and delimiters have to be readable *before* that, because staleness is decided by
 * comparing stamps. And it lets the tests exercise this against the committed file from disk,
 * without a network or a browser, which is the difference between a segmenter whose correctness can
 * be checked and one that can only be tried.
 */
export function dictionaryAnalyzer(loadWords: () => Promise<WordList>): Analyzer {
	return {
		name: 'cedict-longest-match-zh',

		// Declared rather than fingerprinted, and honestly so: unlike `Intl.Segmenter`, this
		// analyzer's behaviour is entirely in this file and in the word list. The list's content
		// hash is part of the version, so regenerating it restamps every document and re-derives
		// them, rather than leaving two different segmentations sharing one version (ADR-0011).
		version: `1-${WORDLIST_VERSION}`,

		language: 'zh',
		unitDelimiters: CHINESE_UNIT_DELIMITERS,

		async analyze(text: string): Promise<AnalyzedToken[]> {
			const words = await loadWords();
			const tokens: AnalyzedToken[] = [];

			for (const unit of splitIntoUnits(text, CHINESE_UNIT_DELIMITERS)) {
				const characters = codePointsOf(unit.text);
				let at = 0;

				while (at < characters.length) {
					// Only runs of hanzi are looked up. Everything else is tiled and not markable,
					// exactly as slice 0 decided — but as a *run* rather than character by
					// character, because 3.14 shown as 3 . 1 4 is four tokens the reader has to
					// reassemble by eye. The word list is unaffected either way, since none of it
					// is markable; this is about the text being readable.
					if (!isHan(characters[at])) {
						let end = at;
						while (end < characters.length && !isHan(characters[end])) end += 1;
						tokens.push({ start: unit.start + at, end: unit.start + end, isWord: false });
						at = end;
						continue;
					}

					const longest = Math.min(LONGEST_WORD, characters.length - at);
					let length = 1;
					for (let candidate = longest; candidate > 1; candidate--) {
						if (words.has(characters.slice(at, at + candidate).join(''))) {
							length = candidate;
							break;
						}
					}

					tokens.push({
						start: unit.start + at,
						end: unit.start + at + length,
						isWord: true
					});
					at += length;
				}
			}

			return tokens;
		},

		lexemeKey(surface: string): string {
			return surface;
		}
	};
}
