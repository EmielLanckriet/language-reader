import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
	PLAIN,
	cutChinese,
	englishShown,
	frozen,
	joinChinese,
	joinEnglish,
	layoutOf,
	placedOf,
	shiftEnglish,
	shiftTime,
	shownOf,
	spansOf,
	splitEnglish,
	timedCues,
	wordsOf,
	type Layout,
	type Shown,
	type Span
} from '../../src/lib/media/layout';
import type { Cue } from '../../src/lib/media/subtitles';

const cue = (start: number, end: number, text: string): Cue => ({ start, end, text });
const cues = [cue(0, 2, '你今天怎么样'), cue(3, 5, '我很好'), cue(5, 7, '谢谢你')];

/** The text of a shown line. */
function textOf(cues: readonly Cue[], shown: Shown): string {
	let text = '';
	for (let line = shown.from.line; line < cues.length; line++) {
		const chars = Array.from(cues[line].text);
		const from = line === shown.from.line ? shown.from.at : 0;
		if (line > shown.to.line || (line === shown.to.line && shown.to.at === 0)) break;
		const to = line === shown.to.line ? shown.to.at : chars.length;
		text += chars.slice(from, to).join('');
	}
	return text;
}

describe('the Chinese cut into lines by hand', () => {
	it('shows the lines as they are until the reader changes them', () => {
		const shown = shownOf(cues, PLAIN);
		expect(shown.map((s) => [s.start, s.end])).toEqual([
			[0, 2],
			[3, 5],
			[5, 7]
		]);
		expect(shown.map((s) => textOf(cues, s))).toEqual(cues.map((c) => c.text));
	});

	it('joins two lines into one that runs from the first start to the second end', () => {
		const joined = joinChinese(PLAIN, shownOf(cues, PLAIN), 0, 1);
		const shown = shownOf(cues, joined);
		expect(shown.map((s) => textOf(cues, s))).toEqual(['你今天怎么样我很好', '谢谢你']);
		expect([shown[0].start, shown[0].end]).toEqual([0, 5]);
	});

	it('cuts a line inside, timing the cut by the characters before it', () => {
		const shown = shownOf(cues, cutChinese(PLAIN, { line: 0, at: 3 }));
		expect(shown.map((s) => textOf(cues, s))).toEqual(['你今天', '怎么样', '我很好', '谢谢你']);
		expect([shown[0].end, shown[1].start, shown[1].end]).toEqual([1, 1, 2]);
	});

	it('reads the joins sentences.json kept', () => {
		expect(layoutOf(undefined, [[0, 2]]).joined).toEqual([1, 2]);
		expect(shownOf(cues, layoutOf(undefined, [[0, 2]]))).toHaveLength(1);
	});

	it('shifts one line, or every line, and the recorder hears the shifted times', () => {
		const shown = shownOf(cues, PLAIN);
		const one = shiftTime(PLAIN, shown, 1, 500, false);
		expect(shownOf(cues, one).map((s) => s.start)).toEqual([0, 3.5, 5]);
		const all = shiftTime(one, shown, 0, -1000, true);
		expect(shownOf(cues, all).map((s) => s.start)).toEqual([0, 2.5, 4]);
		expect(timedCues(cues, all, shownOf(cues, all)).map((c) => c.start)).toEqual([0, 2.5, 4]);
	});

	it('tiles the text whatever is joined and cut', () => {
		const lines = fc.array(
			fc.string({ unit: fc.constantFrom('一', '二', '三', '四'), minLength: 1, maxLength: 6 }),
			{
				minLength: 1,
				maxLength: 8
			}
		);
		const edits = fc.array(
			fc.record({
				kind: fc.constantFrom('join', 'cut'),
				n: fc.nat(),
				at: fc.nat(),
				way: fc.constantFrom(-1 as const, 1 as const)
			}),
			{ maxLength: 12 }
		);
		fc.assert(
			fc.property(lines, edits, (texts, steps) => {
				const cs = texts.map((t, i) => cue(i * 2, i * 2 + 1, t));
				let layout: Layout = PLAIN;
				for (const step of steps) {
					const shown = shownOf(cs, layout);
					if (step.kind === 'join')
						layout = joinChinese(layout, shown, step.n % shown.length, step.way);
					else {
						const line = step.n % cs.length;
						layout = cutChinese(layout, {
							line,
							at: step.at % (Array.from(cs[line].text).length + 1)
						});
					}
				}
				const shown = shownOf(cs, layout);
				expect(shown.map((s) => textOf(cs, s)).join('')).toBe(texts.join(''));
				expect(shown.every((s) => textOf(cs, s).length > 0)).toBe(true);
				for (let i = 1; i < shown.length; i++)
					expect(shown[i].start).toBeGreaterThanOrEqual(shown[i - 1].start);
			})
		);
	});
});

describe('the English of the shown lines', () => {
	it('gives a piece cut off a line that line’s English, as one sentence over both', () => {
		const shown = shownOf(cues, cutChinese(PLAIN, { line: 0, at: 3 }));
		const english = englishShown(shown, [
			{ text: 'How are you today?', source: 'human' },
			{ text: "I'm fine", source: 'human' },
			undefined
		]);
		expect(english.slice(0, 2)).toEqual([
			{ text: 'How are you today?', source: 'human', continues: true },
			{ text: 'How are you today?', source: 'human' }
		]);
	});

	it('shows a sentence repeated across joined lines once', () => {
		const shown = shownOf(cues, layoutOf(undefined, [[0, 1]]));
		const run = {
			text: 'How are you today? Fine',
			source: 'human' as const,
			continues: true as const
		};
		const english = englishShown(shown, [run, { text: run.text, source: 'human' }, undefined]);
		expect(english[0]?.text).toBe('How are you today? Fine');
	});
});

describe('English placed by hand', () => {
	const spans: Span[] = [
		{ a: 0, b: 0, text: "How are you today? I'm" },
		{ a: 1, b: 1, text: 'fine, thank you.' }
	];

	it('splits a line and puts the rest ahead of the next line’s English', () => {
		expect(splitEnglish(spans, 0, 4, 3)).toEqual([
			{ a: 0, b: 0, text: 'How are you today?' },
			{ a: 1, b: 1, text: "I'm fine, thank you." }
		]);
	});

	it('joins two lines’ English into one sentence over both', () => {
		expect(joinEnglish(spans, 1, -1, 3)).toEqual([
			{ a: 0, b: 1, text: "How are you today? I'm fine, thank you." }
		]);
	});

	it('moves a line’s English one line later, or everything from there on', () => {
		expect(shiftEnglish(spans, 1, 1, false, 3)).toEqual([
			spans[0],
			{ a: 2, b: 2, text: spans[1].text }
		]);
		expect(shiftEnglish(spans, 0, 1, true, 3)).toEqual([
			{ a: 1, b: 1, text: spans[0].text },
			{ a: 2, b: 2, text: spans[1].text }
		]);
	});

	it('keeps where it was put when the Chinese is cut differently afterwards', () => {
		const shown = shownOf(cues, PLAIN);
		const placed = placedOf(spans, shown);
		const later = shownOf(cues, cutChinese(PLAIN, { line: 0, at: 3 }));
		expect(spansOf(placed, later)).toEqual([
			{ a: 0, b: 1, text: spans[0].text },
			{ a: 2, b: 2, text: spans[1].text }
		]);
	});

	it('starts from the English shown, a sentence over several lines as one', () => {
		expect(
			frozen([
				{ text: 'A b.', source: 'human', continues: true },
				{ text: 'A b.', source: 'human' },
				undefined,
				{ text: 'C.', source: 'llm' }
			])
		).toEqual([
			{ a: 0, b: 1, text: 'A b.' },
			{ a: 3, b: 3, text: 'C.' }
		]);
	});

	it('never loses, adds or reorders a word, whatever is joined, split and moved', () => {
		const word = fc.constantFrom('a', 'b', 'c', 'd', 'e');
		const start = fc.array(fc.array(word, { maxLength: 4 }), { minLength: 2, maxLength: 8 });
		const step = fc.record({
			kind: fc.constantFrom('join', 'split', 'shift', 'shift-on'),
			s: fc.nat(),
			n: fc.nat(),
			way: fc.constantFrom(-1 as const, 1 as const)
		});
		fc.assert(
			fc.property(start, fc.array(step, { maxLength: 15 }), (lines, steps) => {
				const count = lines.length;
				let spans: Span[] = lines.flatMap((words, s) =>
					words.length ? [{ a: s, b: s, text: words.join(' ') }] : []
				);
				const all = () => spans.flatMap((x) => wordsOf(x.text));
				// Words numbered in reading order, so a reordering shows.
				let n = 0;
				spans = spans.map((x) => ({
					...x,
					text: wordsOf(x.text)
						.map((w) => `${w}${n++}`)
						.join(' ')
				}));
				const words = all();
				for (const { kind, s: raw, n: k, way } of steps) {
					const s = raw % count;
					if (kind === 'join') spans = joinEnglish(spans, s, way, count);
					else if (kind === 'split') spans = splitEnglish(spans, s, k % 5, count);
					else spans = shiftEnglish(spans, s, way, kind === 'shift-on', count);
					expect(all()).toEqual(words);
					for (const x of spans) expect(0 <= x.a && x.a <= x.b && x.b < count).toBe(true);
					for (let i = 1; i < spans.length; i++) expect(spans[i].a).toBeGreaterThan(spans[i - 1].b);
				}
			})
		);
	});
});
