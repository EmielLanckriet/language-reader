import { describe, it, expect } from 'vitest';
import { chooseWords, storyLines, writeStory, type Draft } from '../../src/lib/content/story';
import type { Score } from '../../src/lib/content/find';
import type { Memory } from '../../src/lib/domain/memory';
import { State } from 'ts-fsrs';

// Stories with your due words (spec 016): which words are asked for, and the draft loop. The model
// is a stub; what matters is what Reader asks it and which draft it keeps.

const NOW = new Date('2026-10-16T12:00:00Z');

function memory(days: { stabilityDays: number; dueInDays: number; reviewed?: boolean }): Memory {
	return {
		stability: days.stabilityDays,
		difficulty: 5,
		state: State.Review,
		lastAt: new Date(NOW.getTime() - 86_400_000).toISOString(),
		due: new Date(NOW.getTime() + days.dueInDays * 86_400_000).toISOString(),
		reps: 3,
		lapses: 0,
		card: true,
		reviewed: days.reviewed ?? true
	};
}

describe('the words a story asks for', () => {
	it('are due cards and known words, most frequent in the library first', () => {
		const vocabulary = [
			{ id: 1, form: '坚持', count: 3 },
			{ id: 2, form: '说明', count: 9 },
			{ id: 3, form: '我们', count: 50 },
			{ id: 4, form: '朋友', count: 20 },
			{ id: 5, form: '建设', count: 1 },
			{ id: 6, form: '那里', count: 5 }
		];
		const reading = new Map<number, Partial<Record<'reading', Memory>>>([
			[1, { reading: memory({ stabilityDays: 5, dueInDays: -1 }) }],
			[2, { reading: memory({ stabilityDays: 5, dueInDays: -2 }) }],
			[3, { reading: memory({ stabilityDays: 300, dueInDays: 200 }) }],
			[4, { reading: memory({ stabilityDays: 300, dueInDays: 200 }) }],
			// Due by date, but not an active card: never asked for as due.
			[5, { reading: memory({ stabilityDays: 5, dueInDays: -1, reviewed: false }) }]
		]);
		const states = new Map([[6, { lexemeId: 6, state: 'ignored' } as never]]);
		const words = chooseWords(vocabulary, states, reading, NOW, undefined, { due: 10, known: 1 });
		expect(words.due).toEqual(['说明', '坚持']);
		expect(words.known).toEqual(['我们']);
	});
});

describe('the draft loop', () => {
	function scored(neverMetWords: string[], known: number): Score & { neverMetWords: string[] } {
		return { known, due: [], neverMet: neverMetWords.length, neverMetWords, understood: known };
	}

	it('asks to replace the never-met words, at most twice, and keeps the best draft', async () => {
		const asked: string[] = [];
		const drafts = ['一稿', '二稿', '三稿', '四稿'];
		const scores: Record<string, Score & { neverMetWords: string[] }> = {
			一稿: scored(['生词', '难词'], 0.8),
			二稿: scored(['怪词'], 0.9),
			三稿: scored(['又一个'], 0.85),
			四稿: scored([], 0.99)
		};
		const progress: string[] = [];
		const story: Draft = await writeStory(
			{ due: ['说明'], known: ['我们'] },
			{ length: 300 },
			{
				write: async (messages) => {
					asked.push(messages.at(-1)!.content);
					return { text: drafts[asked.length - 1], where: 'phone' };
				}
			},
			async (text) => scores[text],
			(step) => progress.push(`${step.draft} ${step.where}`)
		);
		expect(asked).toHaveLength(3);
		expect(asked[1]).toContain('生词');
		expect(asked[1]).toContain('难词');
		expect(asked[2]).toContain('怪词');
		expect(story.text).toBe('二稿');
		expect(story.drafts).toBe(3);
		expect(progress).toContain('1 phone');
	});

	it('stops as soon as a draft has no never-met word', async () => {
		let calls = 0;
		const story = await writeStory(
			{ due: [], known: [] },
			{ length: 150, topic: '在市场' },
			{
				write: async (messages) => (
					calls++,
					{ text: messages[1].content.includes('在市场') ? '好' : '?', where: 'laptop' }
				)
			},
			async () => scored([], 0.95)
		);
		expect(calls).toBe(1);
		expect(story.text).toBe('好');
		expect(story.where).toBe('laptop');
	});
});

describe('a story spoken', () => {
	it('is one line per sentence, its punctuation and closing quote kept, nothing lost', () => {
		const text = '我昨天去超市。她问：“你买什么？”我说：“青菜！”\n\n后来我们回家了';
		const lines = storyLines(text);
		expect(lines).toEqual([
			'我昨天去超市。',
			'她问：“你买什么？”',
			'我说：“青菜！”',
			'后来我们回家了'
		]);
		expect(lines.join('')).toBe(text.replace(/\s/g, ''));
	});
});
