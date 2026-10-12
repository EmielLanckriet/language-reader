/**
 * Which of a long list's lines to render: those reaching into the screen or a buffer around it,
 * with spacers standing for the rest (issue #1: all 652 lines of a film took 1.3 s on the phone).
 * Heights are the lines' measured ones, `estimate` for lines not rendered yet. Offsets are from the
 * list's top; lines `first` up to but not including `last` are rendered.
 */
export interface LineWindow {
	first: number;
	last: number;
	before: number;
	after: number;
}

export function lineWindow(
	heights: readonly (number | undefined)[],
	estimate: number,
	top: number,
	height: number,
	buffer: number
): LineWindow {
	const size = (i: number) => heights[i] ?? estimate;
	let total = 0;
	for (let i = 0; i < heights.length; i++) total += size(i);
	let from = top - buffer;
	let to = top + height + buffer;
	// Scrolled past the end, as when lines shrink once measured: show the end rather than nothing.
	if (from >= total) {
		from = Math.max(0, total - height - 2 * buffer);
		to = total;
	}

	let first = 0;
	let before = 0;
	while (first < heights.length && before + size(first) <= from) before += size(first++);
	let last = first;
	let through = before;
	while (last < heights.length && through < to) through += size(last++);
	return { first, last, before, after: total - through };
}

/** Where line `line` starts, from the list's top. */
export function offsetOf(
	heights: readonly (number | undefined)[],
	estimate: number,
	line: number
): number {
	let offset = 0;
	for (let i = 0; i < line; i++) offset += heights[i] ?? estimate;
	return offset;
}
