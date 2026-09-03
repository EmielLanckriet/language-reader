// Candidate: greedy longest match over CC-CEDICT.
//
// At every position, take the longest dictionary entry (traditional or simplified) that starts
// there; if no entry of any length matches — including length 1 — fall back to a single-character
// token, so no character is ever dropped. This is the simplest dictionary-driven segmentation
// method there is, and the one CC-CEDICT is most naturally used for.
//
// Data: CC-CEDICT, MDBG's export, fetched at run time and cached in data/ (never committed, never
// bundled — ADR-0012). 3.97 MB gzipped, measured in research.md R5.

import { fetchCached } from '../lib/fetch-data.mjs';
import { codePointsOf } from '../lib/offsets.mjs';

export const id = 'cedict-longest-match';
export const label = 'CC-CEDICT, greedy longest match';

const URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';

async function loadDictionaryText() {
	return fetchCached(URL, 'cedict_1_0_ts_utf-8_mdbg.txt', { gunzip: true });
}

/**
 * Parse CC-CEDICT's line format: `TRADITIONAL SIMPLIFIED [PINYIN] /def1/def2/.../`, one entry per
 * line, comment lines starting with `#`. Both the traditional and simplified headwords are added as
 * dictionary words — Chinese text a reader pastes may contain traditional characters inside
 * otherwise simplified text (an edge case the spec names by name), and a longest-match segmenter
 * should recognise a traditional word wherever it appears rather than falling back to characters.
 */
function parseCedict(text) {
	const words = new Set();
	let maxWordLength = 1;

	for (const line of text.split('\n')) {
		if (line.length === 0 || line.startsWith('#')) continue;

		const headwordEnd = line.indexOf('[');
		if (headwordEnd === -1) continue;

		const [traditional, simplified] = line.slice(0, headwordEnd).trim().split(/\s+/);
		if (!traditional || !simplified) continue;

		for (const word of [traditional, simplified]) {
			words.add(word);
			maxWordLength = Math.max(maxWordLength, codePointsOf(word).length);
		}
	}

	return { words, maxWordLength };
}

export async function prepare() {
	const dictionaryText = await loadDictionaryText();
	const { words, maxWordLength } = parseCedict(dictionaryText);

	return {
		segmentUnit(unitText) {
			const characters = codePointsOf(unitText);
			const tokens = [];

			let position = 0;
			while (position < characters.length) {
				let matchLength = 0;

				const longestPossible = Math.min(maxWordLength, characters.length - position);
				for (let length = longestPossible; length >= 2; length--) {
					const candidate = characters.slice(position, position + length).join('');
					if (words.has(candidate)) {
						matchLength = length;
						break;
					}
				}

				// No multi-character entry matched here — fall back to one character, whether or not
				// that single character itself is a CC-CEDICT headword. A character absent from every
				// dictionary must still become a token (FR-008's rule, applied to this candidate too):
				// it may be wrongly split from its neighbours, but it is never dropped.
				if (matchLength === 0) matchLength = 1;

				const text = characters.slice(position, position + matchLength).join('');
				tokens.push({ start: position, end: position + matchLength, text });
				position += matchLength;
			}

			return tokens;
		}
	};
}
