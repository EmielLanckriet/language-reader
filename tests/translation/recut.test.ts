import { describe, expect, it } from 'vitest';
import { recutTrack, wordsOfTrack } from '../../src/lib/translation/recut';

// A few CC-CEDICT entries, as the dictionary worker holds them.
const cedict: Record<string, { pinyin: string; meaning: string }[]> = {
	欢迎: [{ pinyin: 'huan1 ying2', meaning: 'to welcome' }],
	主持人: [{ pinyin: 'zhu3 chi2 ren2', meaning: 'host; MC' }],
	自行车: [{ pinyin: 'zi4 xing2 che1', meaning: 'bicycle' }],
	火锅: [{ pinyin: 'huo3 guo1', meaning: 'hot pot' }],
	好吃: [{ pinyin: 'hao3 chi1', meaning: 'tasty; delicious' }]
};

describe('a human track re-cut over the lines', () => {
	it('moves English that drifted lines late back under its Chinese, word for word', () => {
		const chinese = ['欢迎主持人', '他骑自行车', '我们吃火锅', '火锅很好吃'];
		// As 非诚勿扰's track: the right words, each piece a line late.
		const pieces = [
			undefined,
			'Welcome our host!',
			'He rides a bicycle.',
			'We eat hot pot. The hot pot is delicious.'
		];
		const cut = recutTrack(pieces, chinese, (word) => cedict[word]);
		expect(wordsOfTrack(cut).words).toEqual(wordsOfTrack(pieces).words);
		expect(cut).toEqual([
			'Welcome our host!',
			'He rides a bicycle.',
			'We eat hot pot.',
			'The hot pot is delicious.'
		]);
	});
});
