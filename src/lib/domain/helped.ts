/**
 * Where English was on screen in a session (spec 013, ADR-0037). An untapped word under shown
 * English is neither understood nor not, so the evidence rule leaves it out.
 *
 * Two ways English shows: one line or sentence at a time (a reveal, the translate link), or every
 * line at once — the stage with blur off, or the list's "show all English". The second counts for
 * the whole session if it happened at any moment: cautious, and it needs no timing of exposures.
 */

export interface ShownEnglish {
	kind: string;
	fromOffset?: number;
	toOffset?: number;
	detail?: Record<string, unknown>;
}

export type Help = { whole: true } | { whole: false; spans: [number, number][] };

/**
 * The help in a session from its `translation` and `setting` encounters, in history order. A
 * session with no record of its settings counts as blurred: until 2026-10-04 the opening state was
 * not recorded, and the reader normally keeps English blurred.
 */
export function helpOf(encounters: ShownEnglish[], lineRanges: [number, number][]): Help {
	const spans: [number, number][] = [];
	let stage = true;
	let blurEnglish = true;
	for (const encounter of encounters) {
		const detail = encounter.detail ?? {};
		if (encounter.kind === 'translation') {
			if (encounter.fromOffset !== undefined && encounter.toOffset !== undefined)
				spans.push([encounter.fromOffset, encounter.toOffset]);
			else if (typeof detail.line === 'number' && lineRanges[detail.line])
				spans.push(lineRanges[detail.line]);
		} else if (encounter.kind === 'setting') {
			if (detail.name === 'stage') stage = detail.value === true;
			if (detail.name === 'blurEnglish') blurEnglish = detail.value !== false;
			if (detail.name === 'showAllEnglish' && detail.value === true) return { whole: true };
			if (stage && !blurEnglish) return { whole: true };
		}
	}
	return { whole: false, spans };
}

/** Whether the occurrence from `from` to `to` was under shown English. */
export function isHelped(help: Help, from: number, to: number): boolean {
	return help.whole || help.spans.some(([start, end]) => start <= from && to <= end);
}

/** Line i's code-point range: lines are the raw content's, one per subtitle cue in a video. */
export function lineRangesOf(characters: string[]): [number, number][] {
	const ranges: [number, number][] = [];
	let start = 0;
	for (let i = 0; i <= characters.length; i++) {
		if (i === characters.length || characters[i] === '\n') {
			ranges.push([start, i]);
			start = i + 1;
		}
	}
	return ranges;
}
