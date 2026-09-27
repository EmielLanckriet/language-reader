/**
 * What the word sheet says a word means, from CC-CEDICT entries (lookup.ts loads them).
 *
 * Measured on a real street-interview video (2026-09-27): 17% of words showed a useless first
 * meaning — CC-CEDICT lists 钱 "surname Qian" before "money" — and 11% of multi-character words were
 * missing, falling back to one meaning per character (县子 as county + child, not county + suffix).
 */

export interface Entry {
	pinyin: string;
	meaning: string;
}

export interface Part {
	text: string;
	entries: Entry[];
}

export type Dictionary = ReadonlyMap<string, Entry[]>;

const RARE_SENSE =
	/^(surname|variant of|old variant|used in|see |archaic|Japanese variant)|\((archaic|classical|literary|old)\)/i;

/** An entry nobody reading today means: every one of its senses is a name, a variant or archaic. */
const rarelyMeant = (meaning: string) =>
	meaning.split(/;\s*/).every((sense) => RARE_SENSE.test(sense));

/**
 * Entries in the order worth reading: ordinary senses, then bound forms and names, then the rest.
 * Given the reading heard in context (pinyin-pro, as shown above the characters), an ordinary
 * sense with that reading comes first: 说 in 怎么说 is shuō "to speak", not shuì "to persuade".
 */
export function ranked(entries: readonly Entry[], reading?: string): Entry[] {
	const tier = (entry: Entry) =>
		rarelyMeant(entry.meaning)
			? 2
			: /^\(bound form\)/.test(entry.meaning) || /^\p{Lu}/u.test(entry.pinyin)
				? 1
				: 0;
	const heard = (entry: Entry) =>
		reading !== undefined && entry.pinyin.toLowerCase() === reading.toLowerCase() ? 0 : 1;
	return entries
		.map((entry, i) => ({ entry, i }))
		.sort(
			(a, b) =>
				Number(tier(a.entry) === 2) - Number(tier(b.entry) === 2) ||
				heard(a.entry) - heard(b.entry) ||
				tier(a.entry) - tier(b.entry) ||
				a.i - b.i
		)
		.map(({ entry }) => entry);
}

const DIGITS: Record<string, number> = {
	零: 0,
	〇: 0,
	一: 1,
	二: 2,
	两: 2,
	三: 3,
	四: 4,
	五: 5,
	六: 6,
	七: 7,
	八: 8,
	九: 9
};
const UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 1e4, 亿: 1e8 };

/** 四千 → 4000, 三十千 → 30000. Undefined for anything that is not only numerals. */
export function numberOf(text: string): number | undefined {
	if (![...text].every((c) => c in DIGITS || c in UNITS)) return undefined;
	let total = 0;
	let section = 0;
	let current = 0;
	for (const c of text) {
		if (c in DIGITS) {
			current = DIGITS[c];
			continue;
		}
		const unit = UNITS[c];
		if (unit >= 1e4) {
			total += (section + current) * unit;
			section = 0;
		} else if (current === 0 && section > 0) {
			section *= unit; // 三十千: a count of thousands
		} else {
			section += (current || 1) * unit;
		}
		current = 0;
	}
	return total + section + current;
}

/** 两三千 → "2,000–3,000"; a plain numeral → "4,000". */
function numberMeaning(text: string): string | undefined {
	const characters = [...text];
	for (let i = 0; i + 1 < characters.length; i++) {
		const [a, b] = [DIGITS[characters[i]], DIGITS[characters[i + 1]]];
		if (a === undefined || b !== a + 1) continue;
		const low = numberOf([...characters.slice(0, i + 1), ...characters.slice(i + 2)].join(''));
		const high = numberOf([...characters.slice(0, i), ...characters.slice(i + 1)].join(''));
		if (low !== undefined && high !== undefined)
			return `${low.toLocaleString('en')}–${high.toLocaleString('en')}`;
	}
	return numberOf(text)?.toLocaleString('en');
}

/** Neutral-tone noun suffixes: at the end of a word the dictionary lacks, this is what they are. */
const SUFFIXES: Record<string, string> = { 子: 'zi', 儿: 'r', 头: 'tou' };

/**
 * The word as one part when the dictionary has it; otherwise as a number, or as the longest
 * dictionary words it is made of (怎么说 → 怎么 + 说), a character only where nothing longer fits.
 */
export function explain(dictionary: Dictionary, word: string, readings?: string[]): Part[] {
	const characters = [...word];
	const heard = (i: number, j: number) =>
		readings && readings.length === characters.length ? readings.slice(i, j).join(' ') : undefined;

	const whole = dictionary.get(word);
	if (whole) return [{ text: word, entries: ranked(whole, heard(0, characters.length)) }];

	// 听听, 问问: a doubled verb, "do it a little".
	if (characters.length === 2 && characters[0] === characters[1] && dictionary.has(characters[0])) {
		const entries = ranked(dictionary.get(characters[0])!, heard(0, 1));
		return [
			{
				text: word,
				entries: entries.map((e) => ({
					pinyin: `${e.pinyin} ${e.pinyin}`,
					meaning: `${e.meaning} (doubled: briefly, casually)`
				}))
			}
		];
	}

	const number = numberMeaning(word);
	if (number) {
		const pinyin = characters
			.map((c) => ranked(dictionary.get(c) ?? [])[0]?.pinyin ?? '')
			.join(' ');
		return [{ text: word, entries: [{ pinyin, meaning: number }] }];
	}

	const parts: Part[] = [];
	for (let i = 0; i < characters.length;) {
		let j = characters.length;
		while (j > i + 1 && !dictionary.has(characters.slice(i, j).join(''))) j--;
		const text = characters.slice(i, j).join('');
		let entries = ranked(dictionary.get(text) ?? [], heard(i, j));
		const suffix = SUFFIXES[text];
		if (suffix && i > 0 && j === characters.length) {
			entries = [
				...entries.filter((e) => e.pinyin === suffix),
				...entries.filter((e) => e.pinyin !== suffix)
			];
		}
		if (entries.length > 0) parts.push({ text, entries });
		i = j;
	}
	return parts;
}
