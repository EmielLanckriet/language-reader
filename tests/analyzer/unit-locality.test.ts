import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { taggedAnalyzer } from '../../src/lib/analyzer/tagger';
import { CHINESE_UNIT_DELIMITERS } from '../../src/lib/analyzer/delimiters';
import { splitIntoUnits } from '../../src/lib/analyzer/units';
import { codePointsOf } from '../../src/lib/domain/offsets';
import { diskAnalyzer } from './support';
import type { Analyzer } from '../../src/lib/analyzer/types';

// **The fact everything else rests on.**
//
// A document is upgraded to a better analyzer in instalments (ADR-0016), which is only legitimate
// if analysing a stretch of the document on its own gives the same tokens as analysing the whole
// thing. Nothing about batching is safe otherwise: two readers of the same document would get
// different words depending on where their phone happened to be interrupted.
//
// It was asserted in the storage tests first, and an audit showed why that was worthless: those
// use fake analyzers that decide each unit independently, so the property held by construction and
// the test could not fail. So it is checked here, against the analyzers this project actually
// ships, and against a tagger built specifically to notice if the decoder ever looks outside the
// unit it is working on.
//
// The property is not free — it is true only because a unit is exactly the stretch an analyzer is
// allowed to see at once (ADR-0013). An analyzer that consulted its neighbours would break
// resumable upgrades, and this is the test that would say so.

/**
 * A tagger whose answers depend on everything it is shown.
 *
 * The point is sensitivity, not plausibility: every character's tag is a function of the whole
 * chunk handed to the model. So if `taggedAnalyzer` ever fed it a stretch that crossed a unit
 * boundary — or chunked a unit differently depending on what followed it — the tags would change
 * and the property below would fail. A tagger that answered the same way regardless of context
 * could not tell the difference, which is the trap this file exists to avoid falling into twice.
 */
const contextSensitive = taggedAnalyzer(
	async (characters) => {
		const seed = characters.join('').length + characters.length;
		return characters.map((character, i) =>
			(seed + i + character.codePointAt(0)!) % 3 === 0 ? 'B' : 'I'
		);
	},
	'context-sensitive-test',
	'1'
);

const HAN = [...'我在中国学习中文他骑自行车去上班今天气很好你是哪国人她昨买了一本新书'];
const DELIMITERS = [...CHINESE_UNIT_DELIMITERS];

const anyChineseText = fc
	.array(fc.oneof(fc.constantFrom(...HAN), fc.constantFrom(...DELIMITERS)), {
		minLength: 8,
		maxLength: 120
	})
	.map((characters) => characters.join(''));

/** Every offset a batch is allowed to start or stop at. */
function unitBoundaries(text: string, analyzer: Analyzer): number[] {
	const ends = splitIntoUnits(text, analyzer.unitDelimiters).map(
		(unit) => unit.start + codePointsOf(unit.text).length
	);
	return [0, ...ends];
}

function shape(tokens: readonly { start: number; end: number; isWord: boolean }[]) {
	return tokens.map(({ start, end, isWord }) => ({ start, end, isWord }));
}

describe.each([
	['the dictionary analyzer the reader reads with', diskAnalyzer],
	['a tagger whose answers depend on its whole input', contextSensitive]
])('%s', (_name, analyzer: Analyzer) => {
	/**
	 * Compare every stretch a batch could ask for against the whole-document answer.
	 *
	 * Every pair of boundaries, rather than a randomly chosen one. The first version of this test
	 * picked the cut with `fc.double`, which biases hard toward 0 and 1 — so almost every run was
	 * either the whole document (trivially equal) or an empty span (skipped), and the test passed
	 * against a deliberately broken analyzer. Counting the comparisons is what caught that, so the
	 * count stays.
	 */
	async function comparisonsOver(text: string): Promise<number> {
		const boundaries = unitBoundaries(text, analyzer);
		const characters = codePointsOf(text);
		const whole = await analyzer.analyze(text);
		let compared = 0;

		for (const from of boundaries) {
			for (const through of boundaries) {
				if (through <= from) continue;

				const span = characters.slice(from, through).join('');
				const alone = (await analyzer.analyze(span)).map((token) => ({
					...token,
					start: token.start + from,
					end: token.end + from
				}));

				expect(shape(alone)).toEqual(
					shape(whole.filter((token) => token.start >= from && token.start < through))
				);
				compared += 1;
			}
		}

		return compared;
	}

	it('gives the same tokens for a unit-aligned stretch as for the whole document', async () => {
		let compared = 0;

		await fc.assert(
			fc.asyncProperty(anyChineseText, async (text) => {
				compared += await comparisonsOver(text);
			}),
			{ numRuns: 30 }
		);

		// Not decoration. A property that skipped every case would pass, and did.
		expect(compared).toBeGreaterThan(100);
	});

	it('holds on a document with several sentences and a long unbroken run', async () => {
		// The generated texts are short, so nothing above reaches the 500-character chunking inside
		// the decoder. This one does: a chunk boundary is the other place where what the model sees
		// depends on how much text it was handed.
		const long = '我在中国学习中文。' + '学习中文很有意思'.repeat(80) + '！他骑自行车去上班。';
		expect(await comparisonsOver(long)).toBeGreaterThan(2);
	});
});
