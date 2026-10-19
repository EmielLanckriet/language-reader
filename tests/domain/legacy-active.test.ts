import { describe, it, expect } from 'vitest';
import { legacyActive } from '../../src/lib/domain/legacy-active';
import {
	memoryOf,
	type WordHistory,
	type HistoryEvent,
	type Exposure,
	type Mark
} from '../../src/lib/domain/memory';

// The rule before spec 019, pinned before it was replaced (research R4): which words were active
// cards. Each answer was checked against that code before it went (`isActive(memoryOf(h).reading)`
// with `card || known`), as was legacyActive on 3,000 random histories and on every word of the
// reader's backup of 2026-10-16 (2,805 words, 2,111 active, none differing). The switch carries
// these over, so `legacyActive` must keep giving exactly these answers.

const setAsideProvenance = (top: number) => `set aside: outside the ${top} most common words`;

let seq = 0;
const at = (day: number, hour = 10) => new Date(Date.UTC(2026, 9, day, hour)).toISOString();
const ordered = (when: string) => ({ deviceId: 'd', deviceSeq: ++seq, at: when });

const lookup = (session: number, when: string): HistoryEvent => ({
	...ordered(when),
	kind: 'lookup',
	sessionId: session,
	modality: 'reading',
	detail: {}
});
const review = (grade: number, when: string, drill = false): HistoryEvent => ({
	...ordered(when),
	kind: 'review',
	...(drill ? { sessionId: 900, modality: 'hardcore' as const } : {}),
	detail: { skill: 'reading', grade, ...(drill ? { hardcore: { part: 0 } } : {}) }
});
const seen = (session: number, when: string): Exposure => ({
	...ordered(when),
	sessionId: session,
	modality: 'reading',
	helped: false
});
const mark = (asserted: string, provenance: string, when: string): Mark => ({
	...ordered(when),
	asserted,
	provenance
});
const seed = (stability: number) =>
	mark(
		'anki-mature',
		`anki 2026-09-27T20:00:00Z s=${stability} d=5 r=${at(1)} decay=0.2641`,
		at(1)
	);
const history = (parts: Partial<WordHistory>): WordHistory => ({
	marks: [],
	events: [],
	exposures: [],
	answers: new Map(),
	...parts
});
const attentive = new Map([
	[1, 'all' as const],
	[2, 'all' as const]
]);

/** Each case and whether the old rule made it an active card. */
const LEGACY_CASES: [string, () => WordHistory, boolean][] = [
	[
		'a known word: never tapped, met untapped in two attentive sessions',
		() => history({ exposures: [seen(1, at(2)), seen(2, at(3))], answers: attentive }),
		true
	],
	[
		'an Anki word under 14 days, never reviewed in Reader',
		() => history({ marks: [seed(5)] }),
		true
	],
	['an Anki word at 30 days', () => history({ marks: [seed(30)] }), true],
	[
		'a set-aside Anki word under 14 days',
		() => history({ marks: [seed(5), mark('retired', setAsideProvenance(2000), at(2))] }),
		false
	],
	[
		'a set-aside Anki word past 14 days',
		() => history({ marks: [seed(30), mark('retired', setAsideProvenance(2000), at(2))] }),
		true
	],
	[
		'a set-aside Anki word reviewed on Cards after the mark',
		() =>
			history({
				marks: [seed(5), mark('retired', setAsideProvenance(2000), at(2))],
				events: [review(3, at(3))]
			}),
		true
	],
	[
		'an Anki word retired by hand at 22 days',
		() => history({ marks: [seed(22), mark('retired', 'manual', at(2))] }),
		false
	],
	[
		'a word marked learning, with no evidence',
		() => history({ marks: [mark('learning', 'manual', at(1))] }),
		false
	],
	['a tapped word never reviewed', () => history({ events: [lookup(1, at(1))] }), false],
	[
		'a tapped word reviewed on Cards',
		() => history({ events: [lookup(1, at(1)), review(3, at(2))] }),
		true
	],
	[
		'a word drilled past 14 days',
		() =>
			history({
				events: [review(3, at(1), true), review(3, at(5), true), review(3, at(20), true)]
			}),
		true
	],
	[
		'a word drilled once, under 14 days',
		() => history({ events: [review(3, at(1), true)] }),
		false
	],
	[
		'an ignored word that was tapped and reviewed',
		() =>
			history({
				marks: [mark('ignored', 'manual', at(3))],
				events: [lookup(1, at(1)), review(3, at(2))]
			}),
		false
	],
	[
		'a known word retired by hand',
		() =>
			history({
				marks: [mark('retired', 'manual', at(4))],
				exposures: [seen(1, at(2)), seen(2, at(3))],
				answers: attentive
			}),
		false
	]
];

describe('which words were active cards before spec 019', () => {
	it.each(LEGACY_CASES)('%s', (_, make, active) => {
		expect(legacyActive(make())).toBe(active);
	});

	it('really drills the drilled case past 14 days', () => {
		const drilled = LEGACY_CASES.find(([name]) => name === 'a word drilled past 14 days')![1]();
		expect(memoryOf(drilled).reading!.stability).toBeGreaterThanOrEqual(14);
	});
});
