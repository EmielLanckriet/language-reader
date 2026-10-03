import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { choiceNeeded, classifyTracks, defaultChoice } from '../../src/lib/media/subtitles';

// The same table drives translate.py's tests (scripts/termux/test_translate.py): the app and Termux
// must agree on whether a choice is asked, or Termux would translate before or never (spec 012, R5).
const table = JSON.parse(
	readFileSync(new URL('../fixtures/track-choice-cases.json', import.meta.url), 'utf8')
) as {
	cases: {
		name: string;
		tracks: {
			file: string;
			lang: string;
			name: string;
			kind: 'human' | 'automatic';
			vtt: string;
		}[];
		expect: { chinese: string | null; english: string; needed: boolean };
	}[];
};

describe('choosing subtitle tracks', () => {
	for (const { name, tracks, expect: wanted } of table.cases) {
		it(name, () => {
			const classified = classifyTracks(
				tracks.map(({ vtt, ...track }) => ({ ...track, text: vtt }))
			);
			const choice = defaultChoice(classified);
			expect(choice.chinese ?? null).toBe(wanted.chinese);
			expect(choice.english).toBe(wanted.english);
			expect(choiceNeeded(classified)).toBe(wanted.needed);
		});
	}
});
