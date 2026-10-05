import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
	applyCorrections,
	joinWithNext,
	rulesInForce,
	splitAt,
	type Correction,
	type KeyedToken,
	type Rules
} from '../../src/lib/domain/corrections';
import { checkTiling } from '../../src/lib/domain/tiling';

// Properties only: where a correction's cuts fall is the reader's opinion, not something to encode.
// What must hold under any rules is that the text still tiles (SC-007), that no word crosses a
// non-word token (FR-003), and that a rule does what it says where its form is covered.

const ALPHABET = ['一', '个', '人', '国', '是', '，', '。', '\n'];
const isWordChar = (c: string) => !'，。\n'.includes(c);

/** A text and a tiling of it into runs of word or non-word characters, cut at random. */
const tokenized = fc
	.array(fc.tuple(fc.constantFrom(...ALPHABET), fc.boolean()), { minLength: 1, maxLength: 40 })
	.map((cells) => {
		const characters = cells.map(([c]) => c);
		const tokens: KeyedToken[] = [];
		cells.forEach(([c, cut], i) => {
			const last = tokens[tokens.length - 1];
			const word = isWordChar(c);
			if (last && !cut && last.isWord === word) last.end = i + 1;
			else tokens.push({ start: i, end: i + 1, isWord: word });
		});
		for (const t of tokens) if (t.isWord) t.lexemeKey = characters.slice(t.start, t.end).join('');
		return { characters, tokens };
	});

/** Rules over forms that occur in the text, each divided at random. */
function rulesFor(characters: string[], picks: [number, number, number][]): Rules {
	const rules: Rules = new Map();
	for (const [a, len, cut] of picks) {
		const start = a % characters.length;
		const form = characters.slice(start, start + 1 + (len % 4)).join('');
		const cs = [...form];
		const at = cut % cs.length;
		const surfaces = at === 0 ? [form] : [cs.slice(0, at).join(''), cs.slice(at).join('')];
		rules.set(
			form,
			surfaces.map((surface) => ({ surface, key: surface }))
		);
	}
	return rules;
}

const picks = fc.array(fc.tuple(fc.nat(), fc.nat(), fc.nat()), { maxLength: 6 });

describe('applying corrections', () => {
	it('still tiles the text, and no word crosses a non-word character', () => {
		fc.assert(
			fc.property(tokenized, picks, ({ characters, tokens }, p) => {
				const out = applyCorrections(characters, tokens, rulesFor(characters, p));
				expect(checkTiling(out, characters.join(''))).toEqual([]);
				for (const t of out) {
					const text = characters.slice(t.start, t.end);
					if (t.isWord) {
						expect(text.every(isWordChar)).toBe(true);
						expect(t.lexemeKey).toBeDefined();
					}
				}
			})
		);
	});

	it('divides a covered form as the rule says', () => {
		fc.assert(
			fc.property(tokenized, picks, ({ characters, tokens }, p) => {
				const rules = rulesFor(characters, p);
				const out = applyCorrections(characters, tokens, rules);
				// Every word the output made that differs from the input came from a rule's part.
				const before = new Set(tokens.map((t) => `${t.start}-${t.end}`));
				for (const t of out) {
					if (!t.isWord || before.has(`${t.start}-${t.end}`)) continue;
					const surface = characters.slice(t.start, t.end).join('');
					const fromRule = [...rules.values()].some((parts) =>
						parts.some((part) => part.surface === surface)
					);
					expect(fromRule).toBe(true);
				}
			})
		);
	});

	it('joins 一 · 个 and splits 国人, wherever the analyzer cut them', () => {
		const characters = [...'一个国人，一个'];
		const tokens: KeyedToken[] = [
			{ start: 0, end: 1, isWord: true, lexemeKey: '一' },
			{ start: 1, end: 2, isWord: true, lexemeKey: '个' },
			{ start: 2, end: 4, isWord: true, lexemeKey: '国人' },
			{ start: 4, end: 5, isWord: false },
			{ start: 5, end: 7, isWord: true, lexemeKey: '一个' }
		];
		const rules: Rules = new Map([
			['一个', [{ surface: '一个', key: '一个' }]],
			[
				'国人',
				[
					{ surface: '国', key: '国' },
					{ surface: '人', key: '人' }
				]
			]
		]);
		expect(applyCorrections(characters, tokens, rules).map((t) => t.lexemeKey ?? '，')).toEqual([
			'一个',
			'国',
			'人',
			'，',
			'一个'
		]);
	});
});

describe('corrections made on corrected words', () => {
	// Issue #2: the analyzer cut 乾崑智 · 驾; the reader split 乾崑智 → 乾崑 · 智, then joined 智 · 驾,
	// which they could see. The join was saved seven times and never applied.
	it('joins a piece an earlier split made', () => {
		const characters = [...'华为乾崑智驾'];
		const tokens: KeyedToken[] = [
			{ start: 0, end: 2, isWord: true, lexemeKey: '华为' },
			{ start: 2, end: 5, isWord: true, lexemeKey: '乾崑智' },
			{ start: 5, end: 6, isWord: true, lexemeKey: '驾' }
		];
		const rules: Rules = new Map([
			[
				'乾崑智',
				[
					{ surface: '乾崑', key: '乾崑' },
					{ surface: '智', key: '智' }
				]
			],
			['智驾', [{ surface: '智驾', key: '智驾' }]]
		]);
		expect(applyCorrections(characters, tokens, rules).map((t) => t.lexemeKey)).toEqual([
			'华为',
			'乾崑',
			'智驾'
		]);
	});

	it('the latest takes effect wherever its form was covered by the words the reader saw', () => {
		fc.assert(
			fc.property(tokenized, picks, ({ characters, tokens }, p) => {
				const rules = rulesFor(characters, p);
				if (rules.size === 0) return;
				const ordered = [...rules];
				const [form, parts] = ordered[ordered.length - 1];
				const seen = applyCorrections(characters, tokens, new Map(ordered.slice(0, -1)));
				const length = [...form].length;
				// The first place the words on screen covered the form exactly, as a join or split there.
				let at = -1;
				for (let i = 0; i < seen.length && at < 0; i++) {
					let surface = '';
					for (let j = i; j < seen.length && seen[j].isWord; j++) {
						surface += characters.slice(seen[j].start, seen[j].end).join('');
						if (surface === form) at = seen[i].start;
						if (surface.length >= form.length) break;
					}
				}
				if (at < 0) return;
				const out = applyCorrections(characters, tokens, rules);
				const inside = out.filter((t) => t.start >= at && t.end <= at + length);
				expect(inside.map((t) => characters.slice(t.start, t.end).join(''))).toEqual(
					parts.map((part) => part.surface)
				);
			}),
			{ numRuns: 500 }
		);
	});
});

describe('the fold', () => {
	const at = (deviceSeq: number, form: string, parts?: string[]): Correction => ({
		language: 'zh',
		form,
		...(parts ? { parts: parts.map((surface) => ({ surface, key: surface })) } : {}),
		madeAt: '',
		deviceId: 'd',
		deviceSeq,
		userId: 1
	});

	it('keeps the latest per form, and an undo leaves the form to the analyzer', () => {
		const rules = rulesInForce(
			[
				at(3, '一个'),
				at(1, '一个', ['一个']),
				at(2, '国人', ['国', '人']),
				at(4, '国人', ['国人'])
			],
			'zh'
		);
		expect([...rules.keys()]).toEqual(['国人']);
		expect(rules.get('国人')!.map((p) => p.surface)).toEqual(['国人']);
	});

	it('orders the rules by when their latest correction was made', () => {
		const rules = rulesInForce(
			[at(1, '一个', ['一个']), at(2, '国人', ['国', '人']), at(3, '一个', ['一', '个'])],
			'zh'
		);
		expect([...rules.keys()]).toEqual(['国人', '一个']);
	});
});

describe('what the reader may ask for', () => {
	const characters = [...'一个。'];
	const tokens: KeyedToken[] = [
		{ start: 0, end: 1, isWord: true },
		{ start: 1, end: 2, isWord: true },
		{ start: 2, end: 3, isWord: false }
	];

	it('refuses a join across punctuation or past the end', () => {
		expect(joinWithNext(characters, tokens, 0)).toEqual({ form: '一个', parts: ['一个'] });
		expect(joinWithNext(characters, tokens, 1)).toHaveProperty('refused');
		expect(joinWithNext(characters, tokens, 2)).toHaveProperty('refused');
	});

	it('refuses a split with an empty half', () => {
		expect(splitAt('国人', 1)).toEqual({ form: '国人', parts: ['国', '人'] });
		expect(splitAt('国人', 0)).toHaveProperty('refused');
		expect(splitAt('国人', 2)).toHaveProperty('refused');
	});
});
