/// <reference lib="webworker" />
/**
 * CC-CEDICT, loaded and looked up off the page's thread (lookup.ts): parsing its 125,000 lines
 * held the page for 0.4 s on the phone at the first tap of each start (issue #41).
 */

import { explain, type Entry } from './gloss';
import { recutTrack } from '$lib/translation/recut';

let loading: Promise<Map<string, Entry[]>> | undefined;

async function load(url: string): Promise<Map<string, Entry[]>> {
	const response = await fetch(url);
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

self.onmessage = async (event: MessageEvent) => {
	const { id, url, word, readings, words, recut } = event.data;
	try {
		loading ??= load(url).catch((error) => {
			loading = undefined;
			throw error;
		});
		const dictionary = await loading;
		if (recut) {
			// A human track re-cut over the lines (translation/recut.ts): seconds for a long video.
			const lines = recutTrack(recut.pieces, recut.chinese, (w) => dictionary.get(w));
			self.postMessage({ id, parts: lines });
			return;
		}
		// A list of words (the word list, issue #47) is answered in one message, not one per word.
		const parts = words
			? (words as string[]).map((each) => explain(dictionary, each))
			: explain(dictionary, word, readings);
		self.postMessage({ id, parts });
	} catch (error) {
		self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
	}
};
