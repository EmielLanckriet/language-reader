/**
 * Turning a contextual tagger's per-character answers into tokens.
 *
 * A Chinese word segmentation model reads a sentence and says, for each character, whether a word
 * *begins* there (B) or *continues* the previous one (I). That is the whole model interface. Making
 * tokens out of it is ours, and this file is the part that has to be right regardless of what the
 * model says — including when it says something incoherent, which a quantised model occasionally
 * will.
 *
 * **Why a model at all.** Dictionary matching cannot resolve boundaries that depend on context, and
 * measurement says so rather than intuition: 你是哪国人 becomes 你 是 哪 国人 under greedy longest
 * match *and* under frequency-weighted maximum-probability scoring, because 国人 is a real word and
 * neither method can see that it is not the word here. Only a contextual tagger fixed it, and the
 * same holds for 三个人 and for 结婚的和尚未结婚的人 (research.md R13).
 *
 * The tagging function is injected rather than imported. The model is 98 MB and fetched at run
 * time, so it can never run in a unit test — but every property that protects earned data can, by
 * driving this decoder with fakes that answer B everywhere, I everywhere, or at random. No answer a
 * model can give may break tiling, offsets or coverage.
 */

import type { Analyzer, AnalyzedToken } from './types';
import { codePointsOf } from '../domain/offsets';
import { splitIntoUnits } from './units';
import { CHINESE_UNIT_DELIMITERS } from './delimiters';

/** 'B' begins a word, 'I' continues the one before it. One answer per character, in order. */
export type Tagging = (characters: readonly string[]) => Promise<readonly ('B' | 'I')[]>;

/**
 * The model sees 512 positions including its own two markers, so 500 leaves comfortable room.
 *
 * Runs longer than this are split. A boundary the model cannot see across is a boundary it may get
 * wrong, which is a quality cost at one point every 500 characters — and the alternative is
 * refusing to segment long text at all.
 */
const LONGEST_RUN = 500;

function isHan(character: string): boolean {
	return /\p{Script=Han}/u.test(character);
}

export function taggedAnalyzer(tag: Tagging, name: string, version: string): Analyzer {
	return {
		name,
		version,
		language: 'zh',
		unitDelimiters: CHINESE_UNIT_DELIMITERS,

		async analyze(text: string): Promise<AnalyzedToken[]> {
			const tokens: AnalyzedToken[] = [];

			for (const unit of splitIntoUnits(text, CHINESE_UNIT_DELIMITERS)) {
				const characters = codePointsOf(unit.text);
				let at = 0;

				while (at < characters.length) {
					// Everything that is not Chinese is tiled as a single unmarkable run, and is
					// never sent to the model: it is not vocabulary, and it would spend sequence
					// budget the model needs for the text that is.
					if (!isHan(characters[at])) {
						let end = at;
						while (end < characters.length && !isHan(characters[end])) end += 1;
						tokens.push({ start: unit.start + at, end: unit.start + end, isWord: false });
						at = end;
						continue;
					}

					let runEnd = at;
					while (runEnd < characters.length && isHan(characters[runEnd])) runEnd += 1;

					// One run of Chinese, in chunks the model can actually see.
					for (let from = at; from < runEnd; from += LONGEST_RUN) {
						const to = Math.min(from + LONGEST_RUN, runEnd);
						const chunk = characters.slice(from, to);
						const tags = await tag(chunk);

						for (let i = 0; i < chunk.length; i++) {
							// A word begins here if the model says so — and always at the start of a
							// chunk, whatever it says. 'I' on the first character would otherwise
							// continue a word that does not exist, and a model quantised to eight
							// bits does occasionally say exactly that.
							const begins = i === 0 || tags[i] !== 'I';
							if (begins) {
								tokens.push({
									start: unit.start + from + i,
									end: unit.start + from + i + 1,
									isWord: true
								});
							} else {
								tokens[tokens.length - 1].end = unit.start + from + i + 1;
							}
						}
					}

					at = runEnd;
				}
			}

			return tokens;
		},

		lexemeKey(surface: string): string {
			return surface;
		}
	};
}
