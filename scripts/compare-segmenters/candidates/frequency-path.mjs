// Candidate: maximum-probability path over a word-frequency dictionary.
//
// This is essentially what jieba does in its default (non-HMM) mode: build a directed acyclic graph
// of every dictionary word that could start at every position, then find the path from the first
// character to the last whose words have the highest combined probability, where a word's
// probability is its frequency divided by the dictionary's total frequency. Two 4-character
// candidates covering the same span are compared as products of per-word probability (summed as
// logs here, for numerical stability), so a segmentation using two well-attested words beats one
// using a single rare (or absent) one.
//
// **Explicitly not implemented**: jieba's HMM-based new-word discovery, which lets it propose words
// absent from its dictionary using a statistical model of character sequences. That is a genuinely
// different technique layered on top of the frequency path, not a detail of it, and reproducing it
// here would risk claiming this candidate is jieba when it is only jieba's dictionary-path core.
// Out-of-dictionary characters here fall back to a low fixed frequency (matching jieba's own
// treatment: `FREQ.get(word, 1)`), which keeps every character reachable per FR-008's rule without
// pretending a statistical model is present.
//
// Data: jieba's own frequency dictionary, `dict.txt`, fetched at run time and cached in data/
// (never committed, never bundled — ADR-0012). 5.07 MB raw, measured in research.md R5.

import { fetchCached } from '../lib/fetch-data.mjs';
import { codePointsOf } from '../lib/offsets.mjs';

export const id = 'frequency-path';
export const label = 'Frequency-scored maximum-probability path (jieba-style)';

const URL = 'https://raw.githubusercontent.com/fxsjy/jieba/master/jieba/dict.txt';

// A word absent from the dictionary is treated as if it occurred once, matching jieba's own
// `FREQ.get(word, 1)` fallback. This keeps the DP well-defined for out-of-dictionary characters
// without inventing a frequency the data does not support.
const DEFAULT_FREQUENCY = 1;

/**
 * Parse jieba's `dict.txt`: one entry per line, `WORD FREQUENCY PART_OF_SPEECH`, space-separated.
 * The part of speech is not used here — this candidate is purely frequency-driven.
 */
function parseFrequencyDictionary(text) {
	const frequency = new Map();
	let maxWordLength = 1;
	let total = 0;

	for (const line of text.split('\n')) {
		if (line.length === 0) continue;
		const [word, freqText] = line.trim().split(/\s+/);
		if (!word || !freqText) continue;

		const freq = Number(freqText);
		if (!Number.isFinite(freq)) continue;

		frequency.set(word, freq);
		total += freq;
		maxWordLength = Math.max(maxWordLength, codePointsOf(word).length);
	}

	return { frequency, total, maxWordLength };
}

/**
 * Every end position (inclusive, in the `characters` array) reachable by a dictionary word starting
 * at `start`. Always includes at least `start` itself, so a character with no dictionary word
 * starting there is still reachable as a one-character token (FR-008's rule again: an unrecognised
 * character must never be dropped, only possibly mis-bounded).
 */
function reachableEndsFrom(start, characters, frequency, maxWordLength) {
	const ends = [];
	const longestPossible = Math.min(maxWordLength, characters.length - start);

	for (let length = 1; length <= longestPossible; length++) {
		const candidate = characters.slice(start, start + length).join('');
		if (frequency.has(candidate)) ends.push(start + length - 1);
	}

	if (ends.length === 0) ends.push(start);
	return ends;
}

export async function prepare() {
	const dictionaryText = await fetchCached(URL, 'jieba-dict.txt');
	const { frequency, total, maxWordLength } = parseFrequencyDictionary(dictionaryText);
	const logTotal = Math.log(total);

	return {
		segmentUnit(unitText) {
			const characters = codePointsOf(unitText);
			const length = characters.length;
			if (length === 0) return [];

			// route[i] holds the best log-probability of segmenting characters[i..length) and the
			// inclusive end position of the first word on that best path — the same backward dynamic
			// program jieba's `calc()` runs, computed from the end of the unit toward its start so
			// that each position's answer only depends on positions already solved.
			const route = new Array(length + 1);
			route[length] = { logProbability: 0, end: length - 1 };

			for (let start = length - 1; start >= 0; start--) {
				let best = -Infinity;
				let bestEnd = start;

				for (const end of reachableEndsFrom(start, characters, frequency, maxWordLength)) {
					const word = characters.slice(start, end + 1).join('');
					const wordFrequency = frequency.get(word) ?? DEFAULT_FREQUENCY;
					const logProbability = Math.log(wordFrequency) - logTotal + route[end + 1].logProbability;

					if (logProbability > best) {
						best = logProbability;
						bestEnd = end;
					}
				}

				route[start] = { logProbability: best, end: bestEnd };
			}

			const tokens = [];
			let position = 0;
			while (position < length) {
				const end = route[position].end;
				tokens.push({
					start: position,
					end: end + 1,
					text: characters.slice(position, end + 1).join('')
				});
				position = end + 1;
			}

			return tokens;
		}
	};
}
