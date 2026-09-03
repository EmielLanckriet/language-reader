import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { parseVocabulary, encodeCharacters } from '../../src/lib/analyzer/bert-tokenizer';

// Tokenizing for a Chinese BERT is genuinely simple -- one character, one id -- which is why this
// is ours rather than a library's. What it must not do is silently mis-map: an id from one
// vocabulary fed to another model produces confident nonsense rather than an error, so the
// assertions here are about the mapping being exactly what the model was trained on.

const vocabulary = parseVocabulary(readFileSync('static/bert-vocab-zh.txt', 'utf-8'));

describe('the BERT vocabulary', () => {
	it('is the one the model was trained with', () => {
		expect(vocabulary.size).toBe(21128);
		expect(vocabulary.get('[CLS]')).toBe(101);
		expect(vocabulary.get('[SEP]')).toBe(102);
		expect(vocabulary.get('[UNK]')).toBe(100);
	});

	it('maps common characters to the ids the model expects', () => {
		// Fixed ids, deliberately: these are facts about a published artifact, not a judgement about
		// language, so asserting them exactly is right where asserting a segmentation would be wrong.
		expect(vocabulary.get('你')).toBe(872);
		expect(vocabulary.get('朋')).toBe(3301);
	});
});

describe('encoding characters for the model', () => {
	it('wraps the sequence in the markers the model was trained with', () => {
		const { inputIds } = encodeCharacters(['你', '好'], vocabulary);
		// The model takes int64, so these are bigints rather than numbers.
		expect(inputIds[0]).toBe(101n); // [CLS]
		expect(inputIds[inputIds.length - 1]).toBe(102n); // [SEP]
		expect(inputIds.length).toBe(4);
		expect([...inputIds]).toEqual([101n, 872n, 1962n, 102n]);
	});

	it('gives every position attention and a single segment', () => {
		const { attentionMask, tokenTypeIds, inputIds } = encodeCharacters(['你', '好'], vocabulary);
		expect(attentionMask).toEqual(new Array(inputIds.length).fill(1n));
		expect(tokenTypeIds).toEqual(new Array(inputIds.length).fill(0n));
	});

	it('falls back to [UNK] for anything absent, rather than dropping it', () => {
		// Dropping a character would shift every tag after it onto the wrong character, which is
		// the offset-corruption failure in a different costume.
		const { inputIds } = encodeCharacters(['你', '\u{2A6B2}'], vocabulary);
		expect(inputIds.length).toBe(4);
		expect(inputIds[2]).toBe(100n); // [UNK], not omitted
	});

	it('produces one id per character, for any input', () => {
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom('你', '好', '中', '国', '\u{2A6B2}'), { maxLength: 40 }),
				(characters) => {
					const { inputIds } = encodeCharacters(characters, vocabulary);
					expect(inputIds.length).toBe(characters.length + 2);
				}
			)
		);
	});
});
