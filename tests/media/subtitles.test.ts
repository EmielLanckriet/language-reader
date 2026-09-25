import { describe, it, expect } from 'vitest';
import { parseSubtitles } from '../../src/lib/media/subtitles';

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
