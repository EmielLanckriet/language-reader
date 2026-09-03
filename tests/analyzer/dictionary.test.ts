import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { codePointsOf, sliceByCodePoints } from '../../src/lib/domain/offsets';
import { diskAnalyzer, diskWordList } from './support';

// The analyzer the reader actually reads with. Its shared obligations are checked in
// contract.test.ts against every implementation; these are the two properties that are about *this*
// one, and neither asserts an expected segmentation.
//
// Both are properties over the word list rather than over anyone's opinion of where words are,
// which is what makes them legitimate under Principle II. "朋友 is one word" would be an opinion.
// "a word this analyzer was given, standing alone, comes back whole" is a claim about the code.

const words = diskWordList;
const analyzer = diskAnalyzer;

const listed = [...words];
const multiCharacter = listed.filter((word) => [...word].length > 1);

describe('the dictionary analyzer', () => {
	it('was given a word list with something in it', () => {
		// Guards against the tests passing because the list failed to load and every property held
		// vacuously over an empty dictionary.
		expect(multiCharacter.length).toBeGreaterThan(50_000);
	});

	it('recognises any listed word, standing alone, as a single word', async () => {
		await fc.assert(
			fc.asyncProperty(fc.constantFrom(...multiCharacter), async (word) => {
				const tokens = await analyzer.analyze(word);
				expect(tokens).toHaveLength(1);
				expect(tokens[0].isWord).toBe(true);
				expect(tokens[0].start).toBe(0);
				expect(tokens[0].end).toBe([...word].length);
			}),
			{ numRuns: 300 }
		);
	});

	it('never invents a compound: every multi-character word it emits is in the list', async () => {
		// The other half of the previous property, and the more important one. A segmenter that
		// merges characters into things no dictionary contains would look like it was working while
		// producing vocabulary the reader cannot study.
		const ALPHABET = [
			'我',
			'在',
			'中',
			'国',
			'朋',
			'友',
			'自',
			'行',
			'车',
			'花',
			'钱',
			'。',
			'a',
			'3'
		];
		const anyText = fc
			.array(fc.constantFrom(...ALPHABET), { maxLength: 60 })
			.map((cs) => cs.join(''));

		await fc.assert(
			fc.asyncProperty(anyText, async (input) => {
				for (const token of await analyzer.analyze(input)) {
					if (!token.isWord) continue; // grouped punctuation and digit runs are not vocabulary
					const surface = sliceByCodePoints(input, token.start, token.end);
					if ([...surface].length > 1) {
						expect(words.has(surface), `emitted "${surface}", which is not in the word list`).toBe(
							true
						);
					}
				}
			})
		);
	});

	it('carries the word list content hash in its version', () => {
		// Regenerating the list must restamp every document. Without this, two different word lists
		// could share one version and the documents they segmented would sit mixed (ADR-0011).
		expect(analyzer.version).toMatch(/^1-[0-9a-f]{8}$/);
	});

	it('leaves runs that no listed word covers as single characters', async () => {
		// A made-up run of hanzi that cannot be in any dictionary. It must still be tiled, one
		// character at a time, rather than dropped or merged into something invented.
		const nonsense = '𠀀𠀋';
		const tokens = await analyzer.analyze(nonsense);
		expect(tokens.map((t) => sliceByCodePoints(nonsense, t.start, t.end)).join('')).toBe(nonsense);
		expect(codePointsOf(nonsense)).toHaveLength(tokens.length);
	});
});
