/**
 * Readings pinyin-pro gets wrong for common heteronyms (#15), as phrases it should read whole.
 *
 * pinyin-pro's own phrases lose to these, so each entry must be a phrase in which the character
 * can only have this reading: 种花 would turn 这种花 into zhòng, 得早 would turn 来得早 into děi.
 * Measured with scripts/compare-pinyin (score-tsv.mjs): the everyday and heteronym sets for the
 * readings fixed, the CPP benchmark for readings broken elsewhere.
 */

import { customPinyin, pinyin } from 'pinyin-pro';

/** Verbs whose 得 is the complement marker (说得很好), commonly misread dé. */
const complementVerbs = [
	'说',
	'讲',
	'写',
	'唱',
	'跑',
	'玩',
	'吃',
	'喝',
	'做',
	'睡',
	'过',
	'走',
	'跳',
	'学',
	'洗',
	'打',
	'画',
	'笑',
	'哭',
	'活',
	'住',
	'穿',
	'开',
	'飞',
	'游',
	'长',
	'听',
	'想',
	'干',
	'弄',
	'搞',
	'卖',
	'买',
	'读',
	'念',
	'演',
	'踢',
	'骑',
	'起',
	'来',
	'去',
	'变',
	'显',
	'值',
	'记'
];

/** Reduplicated adverbs before 地 (慢慢地), commonly misread dì. */
const reduplicated = [
	'慢',
	'快',
	'好',
	'轻',
	'静',
	'悄',
	'默',
	'渐',
	'紧',
	'偷',
	'狠',
	'深',
	'远',
	'高',
	'早',
	'大',
	'常',
	'久',
	'呆',
	'甜',
	'淡',
	'暗',
	'微',
	'牢',
	'稳',
	'匆',
	'急',
	'乖',
	'细',
	'直'
];

/** Adjectives and adverbs commonly followed by adverbial 地. */
const adverbial = [
	'高兴',
	'认真',
	'开心',
	'快乐',
	'小心',
	'努力',
	'大声',
	'仔细',
	'突然',
	'不停',
	'轻声',
	'安静',
	'慢慢儿',
	'偷偷',
	'热情',
	'紧张',
	'生气',
	'耐心',
	'用力',
	'默默',
	'静静',
	'激动',
	'兴奋',
	'温柔',
	'难过',
	'伤心',
	'自然',
	'很快',
	'飞快',
	'一步步',
	'一点点',
	'不断',
	'积极'
];

const phrases: Record<string, string> = {
	// 长 zhǎng: to grow, to look (长得)
	长得: 'zhǎng de',
	长高: 'zhǎng gāo',
	长胖: 'zhǎng pàng',
	长个子: 'zhǎng gè zi',
	// 还 huán: to give back
	还钱: 'huán qián',
	还书: 'huán shū',
	还给: 'huán gěi',
	还清: 'huán qīng',
	还款: 'huán kuǎn',
	还债: 'huán zhài',
	借了不还: 'jiè le bù huán',
	// 得 děi: must
	得去: 'děi qù',
	得走: 'děi zǒu',
	得赶紧: 'děi gǎn jǐn',
	得马上: 'děi mǎ shàng',
	得先: 'děi xiān',
	得花: 'děi huā',
	// 教 jiāo: to teach (教室, 教练, 教育 stay jiào)
	教书: 'jiāo shū',
	教中文: 'jiāo zhōng wén',
	教汉语: 'jiāo hàn yǔ',
	教英语: 'jiāo yīng yǔ',
	教数学: 'jiāo shù xué',
	教我: 'jiāo wǒ',
	教你: 'jiāo nǐ',
	教他: 'jiāo tā',
	教她: 'jiāo tā',
	// others
	为人: 'wéi rén',
	和面: 'huó miàn',
	有空: 'yǒu kòng',
	没空: 'méi kòng',
	数一数: 'shǔ yi shǔ',
	数一下: 'shǔ yí xià',
	背书包: 'bēi shū bāo',
	背孩子: 'bēi hái zi'
};

let applied = false;

/** Teaches pinyin-pro the phrases above, once. The lists' own syllables are pinyin-pro's. */
export function applyPhraseTable(): void {
	if (applied) return;
	applied = true;
	const withDe = (prefix: string) => `${pinyin(prefix)} de`;
	const all = { ...phrases };
	for (const verb of complementVerbs) all[`${verb}得`] ??= withDe(verb);
	for (const a of reduplicated) all[`${a}${a}地`] = withDe(a + a);
	for (const word of adverbial) all[`${word}地`] = withDe(word);
	customPinyin(all);
}
