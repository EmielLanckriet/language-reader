import { describe, it, expect } from 'vitest';
import { titleParts } from '../../src/lib/media/cover';

describe('titleParts', () => {
	it('cuts a YouTube title at its brackets and bars, and leaves a plain one whole', () => {
		expect(titleParts('【年度总结】一口气了解过去一年的全球经济｜关税战新格局')).toEqual([
			'年度总结',
			'一口气了解过去一年的全球经济',
			'关税战新格局'
		]);
		expect(titleParts('上海街头采访：现在大学生一个月花多少钱？')).toEqual([
			'上海街头采访：现在大学生一个月花多少钱？'
		]);
	});
});
