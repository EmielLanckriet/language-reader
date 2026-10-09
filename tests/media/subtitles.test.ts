import { describe, it, expect } from 'vitest';
import {
	classifyTracks,
	defaultChoice,
	lineAt,
	parseSubtitles,
	resumeAt
} from '../../src/lib/media/subtitles';

function chooseChineseTrack(tracks: { name: string; text: string }[]) {
	const file = defaultChoice(
		classifyTracks(
			tracks.map(({ name, text }) => ({ file: name, lang: '', name: '', kind: 'human', text }))
		)
	).chinese;
	return tracks.find((track) => track.name === file);
}

// The first cues of Jun - Stickynote Chinese, xEoY1KyrYls: human tracks zh ("Chinese") and
// zh-Hans ("Chinese (Simplified)"), the latter with a pinyin line under every line.
const CLEAN =
	'WEBVTT\nKind: captions\nLanguage: zh\n\n00:00:00.066 --> 00:00:02.666\n到了中国才发现我的中文有多差，\n\n00:00:02.800 --> 00:00:04.000\n点餐都不行。\n';
const WITH_PINYIN =
	'WEBVTT\nKind: captions\nLanguage: zh-Hans\n\n00:00:00.066 --> 00:00:02.666\n到了中国才发现我的中文有多差，\nDào le zhōngguó cái fāxiàn wǒ de zhōngwén yǒuduōchà,\n\n00:00:02.800 --> 00:00:04.000\n点餐都不行。\ndiǎncān dōu bùxíng.\n';
const WITH_ENGLISH =
	'WEBVTT\n\n00:00:00.066 --> 00:00:02.666\n到了中国才发现我的中文有多差，\nArriving in China, I found out how bad my Chinese was.\n';

describe('choosing the Chinese track', () => {
	it('prefers a clean track over one carrying pinyin, whatever the names say', () => {
		const tracks = [
			{ name: 'media.zh-Hans.vtt', text: WITH_PINYIN },
			{ name: 'media.zh.vtt', text: CLEAN }
		];
		expect(chooseChineseTrack(tracks)?.name).toBe('media.zh.vtt');
	});

	it('prefers a clean track over one carrying English', () => {
		const tracks = [
			{ name: 'media.zh-CN.vtt', text: WITH_ENGLISH },
			{ name: 'media.zh-TW.vtt', text: CLEAN }
		];
		expect(chooseChineseTrack(tracks)?.name).toBe('media.zh-TW.vtt');
	});

	it('still prefers simplified by name between clean tracks', () => {
		const tracks = [
			{ name: 'media.zh.vtt', text: CLEAN },
			{ name: 'media.zh-Hans.vtt', text: CLEAN }
		];
		expect(chooseChineseTrack(tracks)?.name).toBe('media.zh-Hans.vtt');
	});

	it('keeps a mixed track when it is the only one', () => {
		expect(chooseChineseTrack([{ name: 'media.zh-Hans.vtt', text: WITH_PINYIN }])?.name).toBe(
			'media.zh-Hans.vtt'
		);
	});

	it('does not call a clean track mixed for a few Latin words', () => {
		const brands =
			'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\n我用iPhone和微信付款，\n\n00:00:02.000 --> 00:00:03.000\n在Toronto租房子。\n';
		const tracks = [
			{ name: 'media.zh.vtt', text: WITH_PINYIN },
			{ name: 'media.zh-TW.vtt', text: brands }
		];
		expect(chooseChineseTrack(tracks)?.name).toBe('media.zh-TW.vtt');
	});
});

describe('parsing subtitles', () => {
	it('reads timings and joins a multi-line cue onto one line', () => {
		const cues = parseSubtitles(
			'WEBVTT\nKind: captions\n\n00:00:00.100 --> 00:00:06.300\n大家好\n现在\n\n1:02:03.500 --> 1:02:04,000\n<c>再见</c>\n'
		);
		expect(cues).toEqual([
			{ start: 0.1, end: 6.3, text: '大家好 现在' },
			{ start: 3723.5, end: 3724, text: '再见' }
		]);
	});

	it("keeps a human track's deliberate repeats when asked", () => {
		// A translator repeats one English line under the two Chinese cues it covers (MediaStorm,
		// JiD2SK2Yav0); dropping it as a rolled-up repeat left the second Chinese line empty.
		const source =
			'WEBVTT\n\n00:01:22.600 --> 00:01:23.720\nThen, there is something to discuss.\n\n00:01:23.720 --> 00:01:24.720\nThen, there is something to discuss.\n';
		expect(parseSubtitles(source, { keepRepeats: true })).toHaveLength(2);
		expect(parseSubtitles(source)).toHaveLength(1);
	});

	it('collapses a line written twice inside one cue, repeats kept or not', () => {
		const source =
			'WEBVTT\n\n00:04:51.380 --> 00:04:53.719\nspec sheets ever seen.\nspec sheets ever seen.\n';
		expect(parseSubtitles(source, { keepRepeats: true })[0].text).toBe('spec sheets ever seen.');
	});

	it('drops the rolled-up repeat in automatic captions', () => {
		const cues = parseSubtitles(
			'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n我们\n\n00:00:03.000 --> 00:00:05.000\n我们\n去吃饭\n\n00:00:05.000 --> 00:00:05.010\n去吃饭\n'
		);
		expect(cues.map((cue) => cue.text)).toEqual(['我们', '去吃饭']);
	});
});

describe('the line playing at a time', () => {
	// Measured on the phone (issue #3): seeking to 260.59 s, where a line starts, lands at
	// 260.589998. With "stop after each line" the line before then counted as ended at once.
	const cues = [
		{ start: 258.387, end: 260.59, text: '真实地出现在了我们镜头前面' },
		{ start: 260.59, end: 263.993, text: '我们也很乐意把这份质朴又充满力量的生活' },
		{ start: 263.993, end: 264.894, text: '呈现给你' },
		{ start: 306.836, end: 309.405, text: '我们两位摄影师已经睡得非常香' }
	];

	it('counts a seek that lands a hair before a line as that line', () => {
		expect(lineAt(cues, 260.589998)).toBe(1);
	});

	it('keeps the line before until it is really over, and the last line through a gap', () => {
		expect(lineAt(cues, 260.5)).toBe(0);
		expect(lineAt(cues, 280)).toBe(2);
		expect(lineAt(cues, 100)).toBe(-1);
	});
});

describe('where a video continues', () => {
	const cues = [
		{ start: 10, end: 14, text: '一' },
		{ start: 15, end: 19, text: '二' },
		{ start: 30, end: 34, text: '三' }
	];

	it('goes back to the start of the line playback stopped in, or last passed', () => {
		expect(resumeAt(17_500, 600_000, cues)).toBe(15);
		expect(resumeAt(25_000, 600_000, cues)).toBe(15);
		expect(resumeAt(15_000, 600_000, cues)).toBe(15);
	});

	it('starts from the beginning when never played, or stopped before the first line', () => {
		expect(resumeAt(undefined, 600_000, cues)).toBe(0);
		expect(resumeAt(8_000, 600_000, cues)).toBe(0);
	});

	it('starts from the beginning once playback came within 30 s of the end', () => {
		expect(resumeAt(31_000, 61_000, cues)).toBe(0);
		expect(resumeAt(31_000, 61_001, cues)).toBe(30);
		expect(resumeAt(31_000, undefined, cues)).toBe(30);
	});
});
