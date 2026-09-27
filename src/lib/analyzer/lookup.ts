/** Word lookup against CC-CEDICT, loaded the first time a word is looked up. */

import { base } from '$app/paths';
import { explain, type Entry, type Part } from './gloss';

export type { Entry, Part };

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

/** What the word means: see gloss.ts for how a word the dictionary lacks is explained. */
export async function lookUp(word: string, readings?: string[]): Promise<Part[]> {
	loading ??= load().catch((error) => {
		loading = undefined;
		throw error;
	});
	return explain(await loading, word, readings);
}
