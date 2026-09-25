/** Word lookup against CC-CEDICT, loaded the first time a word is looked up. */

import { base } from '$app/paths';

export interface Entry {
	pinyin: string;
	meaning: string;
}

let loading: Promise<Map<string, Entry[]>> | undefined;

async function load(): Promise<Map<string, Entry[]>> {
	const response = await fetch(`${base}/dictionary-zh.txt`);
	if (!response.ok) throw new Error(`the dictionary could not be loaded (${response.status})`);
	const entries = new Map<string, Entry[]>();
	for (const line of (await response.text()).split('\n')) {
		if (!line || line.startsWith('#')) continue;
		const [word, pinyin, meaning] = line.split('\t');
		const list = entries.get(word) ?? [];
		list.push({ pinyin, meaning });
		entries.set(word, list);
	}
	return entries;
}

/** Entries for the word; for a word the dictionary lacks, entries for each of its characters. */
export async function lookUp(word: string): Promise<{ text: string; entries: Entry[] }[]> {
	loading ??= load().catch((error) => {
		loading = undefined;
		throw error;
	});
	const dictionary = await loading;
	const whole = dictionary.get(word);
	if (whole) return [{ text: word, entries: whole }];
	return [...word]
		.map((character) => ({ text: character, entries: dictionary.get(character) ?? [] }))
		.filter((part) => part.entries.length > 0);
}
