import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { englishFor, humanByLine, llmByLine } from '../../src/lib/translation/lines';

/**
 * Principle VIII's one hard rule for translation: the LLM's English is never shown under, or
 * replaced by, the quick model's. Arbitrary gaps on either side, since both arrive line by line.
 */
const line = fc.option(
	fc.string({ minLength: 1 }).filter((s) => s.trim() !== ''),
	{ nil: undefined }
);

describe('choosing each line’s English', () => {
	it('shows the LLM’s line wherever there is one, and the quick line only in its gaps', () => {
		fc.assert(
			fc.property(fc.array(line), fc.array(line), (llm, quick) => {
				const count = Math.max(llm.length, quick.length);
				englishFor(count, llm, quick).forEach((english, i) => {
					if (llm[i]) expect(english).toEqual({ text: llm[i]!.trim(), source: 'llm' });
					else if (quick[i]) expect(english).toEqual({ text: quick[i]!.trim(), source: 'quick' });
					else expect(english).toBeUndefined();
				});
			})
		);
	});
});

describe('matching the LLM’s English to Chinese lines', () => {
	it('by start time, so a line without English leaves the lines after it where they are', () => {
		const chinese = [0, 1.5, 3.2, 4.8].map((start) => ({ start }));
		// translate.py writes no cue for the line it could not place (the second).
		const english = [
			{ start: 0, text: 'Friends' },
			{ start: 3.2, text: 'the global trade war' },
			{ start: 4.8, text: 'was it all for nothing?' }
		];
		expect(llmByLine(chinese, english)).toEqual([
			'Friends',
			undefined,
			'the global trade war',
			'was it all for nothing?'
		]);
	});
});

/** Back-to-back cues from arbitrary gaps and lengths, in tenths of a second. */
function timed(parts: { gap: number; length: number }[]) {
	let at = 0;
	return parts.map(({ gap, length }) => {
		const start = at + gap / 10;
		at = start + length / 10;
		return { start, end: at };
	});
}
const spans = fc.array(fc.record({ gap: fc.nat(20), length: fc.integer({ min: 1, max: 60 }) }), {
	minLength: 1,
	maxLength: 300,
	size: 'max'
});

describe('matching a human English track to Chinese lines (spec 012, research R3)', () => {
	it('shows every English cue once, in order, under the line it overlaps most', () => {
		fc.assert(
			fc.property(spans, spans, (chinese, english) => {
				const zh = timed(chinese);
				const en = timed(english).map((cue, i) => ({ ...cue, text: `e${i}` }));
				const lines = humanByLine(zh, en);
				expect(lines).toHaveLength(zh.length);
				const shown = lines.flatMap((line) => (line ? line.split(' ') : []));
				expect(shown).toEqual(en.map((cue) => cue.text));
			})
		);
	});

	it('puts an English cue under a line it overlaps whenever one does', () => {
		fc.assert(
			fc.property(spans, spans, (chinese, english) => {
				const zh = timed(chinese);
				const en = timed(english).map((cue, i) => ({ ...cue, text: `e${i}` }));
				const lines = humanByLine(zh, en);
				en.forEach((cue) => {
					const overlaps = (i: number) =>
						Math.min(zh[i].end, cue.end) > Math.max(zh[i].start, cue.start);
					if (!zh.some((_, i) => overlaps(i))) return;
					const under = lines.findIndex((line) => line?.split(' ').includes(cue.text));
					expect(overlaps(under)).toBe(true);
				});
			})
		);
	});

	it('shows a repeated line once when both copies land under the same line', () => {
		const zh = [{ start: 0, end: 4 }];
		const en = [
			{ start: 0, end: 2, text: 'It rhymes.' },
			{ start: 2, end: 4, text: 'It rhymes.' }
		];
		expect(humanByLine(zh, en)).toEqual(['It rhymes.']);
	});

	it('maps identically timed tracks one to one', () => {
		fc.assert(
			fc.property(spans, (chinese) => {
				const zh = timed(chinese);
				const en = zh.map((cue, i) => ({ ...cue, text: `e${i}` }));
				expect(humanByLine(zh, en)).toEqual(en.map((cue) => cue.text));
			})
		);
	});

	it('never shows a machine line where a human one exists', () => {
		fc.assert(
			fc.property(fc.array(line), fc.array(line), fc.array(line), (human, llm, quick) => {
				const count = Math.max(human.length, llm.length, quick.length);
				englishFor(count, llm, quick, human).forEach((english, i) => {
					if (human[i]) expect(english).toEqual({ text: human[i]!.trim(), source: 'human' });
				});
			})
		);
	});
});
