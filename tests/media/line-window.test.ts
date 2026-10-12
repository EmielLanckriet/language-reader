import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { lineWindow, offsetOf } from '../../src/lib/media/line-window';

// Issue #1: the video page built every subtitle line (22,845 elements for a 652-line film) on
// every open, hidden behind the stage, and that took 1.3 s on the phone. Only the lines on screen,
// and a buffer around them, are rendered; spacers stand for the rest.

const heights = fc.array(fc.option(fc.integer({ min: 1, max: 400 }), { nil: undefined }), {
	maxLength: 700,
	size: 'max'
});
const view = fc.record({
	estimate: fc.integer({ min: 1, max: 200 }),
	top: fc.integer({ min: -500, max: 200_000 }),
	height: fc.integer({ min: 1, max: 2000 }),
	buffer: fc.integer({ min: 0, max: 2000 })
});

const sized = (all: readonly (number | undefined)[], estimate: number) =>
	all.map((h) => h ?? estimate);
const sum = (values: number[]) => values.reduce((n, v) => n + v, 0);

describe('the lines rendered around the screen', () => {
	it('accounts for every line, rendered or in a spacer', () => {
		fc.assert(
			fc.property(heights, view, (all, { estimate, top, height, buffer }) => {
				const h = sized(all, estimate);
				const w = lineWindow(all, estimate, top, height, buffer);
				expect(0 <= w.first && w.first <= w.last && w.last <= all.length).toBe(true);
				expect(w.before).toBe(sum(h.slice(0, w.first)));
				expect(w.after).toBe(sum(h.slice(w.last)));
			})
		);
	});

	it('renders every line reaching into the screen and its buffer, and no other', () => {
		fc.assert(
			fc.property(heights, view, (all, { estimate, top, height, buffer }) => {
				const h = sized(all, estimate);
				const total = sum(h);
				const w = lineWindow(all, estimate, top, height, buffer);
				const from = top - buffer;
				const to = top + height + buffer;
				// Scrolled past the end (a line shrank, say): the last lines, never an empty page.
				if (from >= total) {
					expect(w.last).toBe(all.length);
					expect(w.last > w.first || all.length === 0).toBe(true);
					return;
				}
				let offset = 0;
				h.forEach((size, i) => {
					const reaches = offset < to && offset + size > from;
					expect(i >= w.first && i < w.last).toBe(reaches);
					offset += size;
				});
			})
		);
	});

	it('leaves out a line that only touches the range, at either edge', () => {
		fc.assert(
			fc.property(
				heights.filter((all) => all.length > 2),
				view,
				fc.nat(),
				fc.nat(),
				(all, { estimate }, a, b) => {
					// The range runs exactly from where line `start` begins to where line `end` begins.
					const start = 1 + (a % (all.length - 2));
					const end = start + 1 + (b % (all.length - start - 1));
					const from = offsetOf(all, estimate, start);
					const to = offsetOf(all, estimate, end);
					const w = lineWindow(all, estimate, from, to - from, 0);
					expect([w.first, w.last]).toEqual([start, end]);
				}
			)
		);
	});

	it('finds where a line starts, and a window opened there shows it', () => {
		fc.assert(
			fc.property(
				heights.filter((all) => all.length > 0),
				view,
				fc.nat(),
				(all, { estimate, height, buffer }, pick) => {
					const line = pick % all.length;
					const top = offsetOf(all, estimate, line);
					expect(top).toBe(sum(sized(all, estimate).slice(0, line)));
					const w = lineWindow(all, estimate, top, height, buffer);
					expect(line >= w.first && line < w.last).toBe(true);
				}
			)
		);
	});
});
