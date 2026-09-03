// Candidate: `Intl.Segmenter('zh', { granularity: 'word' })` — the analyzer the application ships.
//
// **This is a reimplementation, not the shipped code.** It is written to mirror
// `src/lib/analyzer/chinese.ts` as it reads on the date this harness was built (2026-09-02/03), but
// this file cannot import that module — it is TypeScript with an extensionless import, and this
// harness is plain .mjs, deliberately outside `src/` (ADR-0012). Nothing enforces the two staying in
// step: if `chinese.ts` changes and this file is not updated to match, this candidate quietly stops
// measuring what the application actually ships, and the comparison's conclusion about the shipped
// analyzer would be wrong without anyone noticing. Say so plainly in the report, not just here.
//
// What is mirrored, deliberately:
//   - `Intl.Segmenter('zh', { granularity: 'word' })`, nothing more elaborate.
//   - segmented one unit at a time (see lib/units.mjs), never over the whole document at once.
//   - offsets converted from UTF-16 code units to code points via the same map chinese.ts uses.
//   - `isWord` decided by Han script, not by the platform's `isWordLike` (research.md R7) — though
//     this harness only uses isWord for display, never for the boundary metric itself.
//
// Zero data to fetch, so this candidate can never be "unavailable": it is the one candidate the
// application already ships and costs nothing to run.

import { codePointIndexMap, codePointLength } from '../lib/offsets.mjs';

export const id = 'intl-segmenter';
export const label = 'Intl.Segmenter (shipped, zero install cost)';

function isStudiable(surface) {
	return /\p{Script=Han}/u.test(surface);
}

export async function prepare() {
	return {
		segmentUnit(unitText) {
			const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
			const toCharacterIndex = codePointIndexMap(unitText);
			const unitLength = codePointLength(unitText);

			const reported = [...segmenter.segment(unitText)];
			const tokens = [];

			for (let i = 0; i < reported.length; i++) {
				// The dangerous conversion (research.md R2). `reported[i].index` is a UTF-16 code unit
				// index; every offset this harness reports is a code-point index.
				const start = toCharacterIndex[reported[i].index];
				const end = i + 1 < reported.length ? toCharacterIndex[reported[i + 1].index] : unitLength;

				tokens.push({
					start,
					end,
					text: reported[i].segment,
					isWord: isStudiable(reported[i].segment)
				});
			}

			return tokens;
		}
	};
}
