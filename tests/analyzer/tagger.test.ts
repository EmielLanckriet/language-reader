import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { taggedAnalyzer, type Tagging } from '../../src/lib/analyzer/tagger';
import { checkTiling } from '../../src/lib/domain/tiling';
import { codePointsOf, sliceByCodePoints } from '../../src/lib/domain/offsets';

// The contextual tagger says, per character, whether a word begins there (B) or continues (I).
// Turning that into tokens is ours, and it has to satisfy the analyzer contract *whatever the model
// says* — including when the model says something incoherent.
//
// So the tagging function is injected. These tests drive it with fakes: a tagger that begins every
// word, one that never does, one that answers at random. The real model is 98 MB and fetched at run
// time, so it can never be exercised here; what can be exercised is that no answer it gives can
// break tiling, offsets, or coverage. That is the failure that would corrupt earned data, and it is
// the one worth testing.

/** Every character starts a word. */
const allB: Tagging = (characters) => Promise.resolve(characters.map(() => 'B' as const));
/** Nothing starts a word — even the first character, which is incoherent and must be survivable. */
const allI: Tagging = (characters) => Promise.resolve(characters.map(() => 'I' as const));

function seeded(seed: number): Tagging {
	let state = seed;
	return (characters) =>
		Promise.resolve(
			characters.map(() => {
				state = (state * 1103515245 + 12345) & 0x7fffffff;
				return state % 2 === 0 ? ('B' as const) : ('I' as const);
			})
		);
}

const ALPHABET = [
	'我',
	'在',
	'中',
	'国',
	'人',
	'朋',
	'友',
	'。',
	'，',
	'\n',
	'a',
	'Z',
	'3',
	'.',
	' '
];
const anyText = fc.array(fc.constantFrom(...ALPHABET), { maxLength: 90 }).map((cs) => cs.join(''));

describe.each([
	['every character begins a word', allB],
	['no character begins a word', allI],
	['random tags', seeded(7)]
])('decoding tags into tokens, when the model says: %s', (_label, tagging) => {
	const analyzer = taggedAnalyzer(tagging, 'test-tagger', '0');

	it('tiles the document exactly', async () => {
		await fc.assert(
			fc.asyncProperty(anyText, async (text) => {
				expect(checkTiling(await analyzer.analyze(text), text)).toEqual([]);
			})
		);
	});

	it('covers every character exactly once', async () => {
		await fc.assert(
			fc.asyncProperty(anyText, async (text) => {
				const covered = new Array<number>(codePointsOf(text).length).fill(0);
				for (const token of await analyzer.analyze(text)) {
					for (let i = token.start; i < token.end; i++) covered[i] += 1;
				}
				expect(covered.every((n) => n === 1)).toBe(true);
			})
		);
	});

	it('never marks punctuation, whitespace or Latin as studiable', async () => {
		await fc.assert(
			fc.asyncProperty(anyText, async (text) => {
				for (const token of await analyzer.analyze(text)) {
					if (!token.isWord) continue;
					const surface = sliceByCodePoints(text, token.start, token.end);
					expect(/^\p{Script=Han}+$/u.test(surface)).toBe(true);
				}
			})
		);
	});

	it('never lets a word span a unit delimiter', async () => {
		await fc.assert(
			fc.asyncProperty(anyText, async (text) => {
				const characters = codePointsOf(text);
				const swallowed: string[] = [];
				for (const token of await analyzer.analyze(text)) {
					for (let i = token.start; i < token.end - 1; i++) {
						if (analyzer.unitDelimiters.has(characters[i])) swallowed.push(characters[i]);
					}
				}
				expect(swallowed).toEqual([]);
			})
		);
	});

	it('treats empty input as no tokens', async () => {
		expect(await analyzer.analyze('')).toEqual([]);
	});
});

describe('decoding tags into tokens', () => {
	it('groups a non-Han run into one unmarkable token', async () => {
		const analyzer = taggedAnalyzer(allB, 'test-tagger', '0');
		const tokens = await analyzer.analyze('圆周率是3.14');
		const surfaces = tokens.map((t) => sliceByCodePoints('圆周率是3.14', t.start, t.end));
		// The model tags per character; digits and dots are not vocabulary, so they are one token
		// rather than four the reader has to reassemble by eye.
		expect(surfaces).toContain('3.14');
	});

	it('chunks text longer than the model can see, without losing a character', async () => {
		// The model has a 512-position limit. A unit longer than that must still tile exactly.
		const long = '中'.repeat(1500);
		const analyzer = taggedAnalyzer(allI, 'test-tagger', '0');
		const tokens = await analyzer.analyze(long);
		expect(checkTiling(tokens, long)).toEqual([]);
		expect(tokens.at(-1)?.end).toBe(1500);
	});

	it('asks the model only about text it needs tagged', async () => {
		// Sending punctuation and Latin to a Chinese tagger wastes the sequence budget it has.
		const seen: string[][] = [];
		const recording: Tagging = (characters) => {
			seen.push([...characters]);
			return Promise.resolve(characters.map(() => 'B' as const));
		};
		await taggedAnalyzer(recording, 'test-tagger', '0').analyze('朋友。你好');
		for (const batch of seen) {
			for (const character of batch) expect(/\p{Script=Han}/u.test(character)).toBe(true);
		}
	});
});
