// Candidate: `Intl.Segmenter('zh', { granularity: 'word' })`.
//
// **No longer the shipped analyzer, and rejected.** This was the first analyzer the application
// shipped, and it is kept here only as a comparison point, not as the candidate to beat. It was
// rejected because on the reader's own Android Chrome it returned every character as a separate
// segment — not a subtly wrong boundary, but no word boundaries at all — because that build of
// Chrome ships without the CJK dictionary data ICU's word breaking depends on, and `Intl.Segmenter`
// answers anyway rather than signalling that it cannot (research.md R11). A laptop or desktop
// browser gives no warning of this: the same call returns real words there, which is exactly what
// made the gap invisible until it was checked on the actual device. The application now ships
// `bert-ws-zh` instead (see `candidates/bert-ws.mjs`).
//
// **This is a reimplementation, not the shipped code — nor, now, of shipped code at all.** It is
// written to mirror `src/lib/analyzer/chinese.ts` as it read while this was still the shipped
// analyzer (2026-09-02/03), but this file cannot import that module — it is TypeScript with an
// extensionless import, and this harness is plain .mjs, deliberately outside `src/` (ADR-0012).
// Nothing enforces the two staying in step: if `chinese.ts` changes further and this file is not
// updated to match, this candidate quietly stops measuring what it claims to measure. Say so plainly
// in the report, not just here.
//
// What is mirrored, deliberately:
//   - `Intl.Segmenter('zh', { granularity: 'word' })`, nothing more elaborate.
//   - segmented one unit at a time (see lib/units.mjs), never over the whole document at once.
//   - offsets converted from UTF-16 code units to code points via the same map chinese.ts uses.
//   - `isWord` decided by Han script, not by the platform's `isWordLike` (research.md R7) — though
//     this harness only uses isWord for display, never for the boundary metric itself.
//
// Zero data to fetch, so this candidate can never be "unavailable" for lack of a download — the run
// on a real device is what made it unavailable in the sense that matters.

import { codePointIndexMap, codePointLength } from '../lib/offsets.mjs';

export const id = 'intl-segmenter';
export const label = 'Intl.Segmenter (rejected — per-character on the reader’s device, R11)';

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
