import { describe, it, expect } from 'vitest';
import { classifyTracks, defaultChoice, parseSubtitles } from '../../src/lib/media/subtitles';

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

	it('drops the rolled-up repeat in automatic captions', () => {
		const cues = parseSubtitles(
			'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n我们\n\n00:00:03.000 --> 00:00:05.000\n我们\n去吃饭\n\n00:00:05.000 --> 00:00:05.010\n去吃饭\n'
		);
		expect(cues.map((cue) => cue.text)).toEqual(['我们', '去吃饭']);
	});
});
