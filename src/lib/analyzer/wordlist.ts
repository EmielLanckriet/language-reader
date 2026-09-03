/**
 * Fetching the word list the dictionary analyzer segments against.
 *
 * Precached with the rest of the build, so after the first install it is on the device and no
 * reading depends on a network. That is not an optimisation: the reader's phone cannot split
 * Chinese without this file, and slice 1 established that reading offline is not negotiable.
 *
 * Loaded at most once, like `session()` and `serviceWorker()`, and for the same reason — every
 * caller should be asking about the same list rather than fetching a megabyte again.
 *
 * **Failure is loud.** If the list cannot be loaded, `analyze` refuses rather than falling back to
 * something that looks like segmentation and is not. Falling back to the platform's segmenter would
 * be the worst available option: on the reader's own phone it silently returns one token per
 * character, which is the exact failure this analyzer exists to fix, and the reader would have no
 * way to tell the difference.
 */

import { base } from '$app/paths';
import type { WordList } from './dictionary';

let loading: Promise<WordList> | undefined;

export function wordList(): Promise<WordList> {
	loading ??= load();
	return loading;
}

async function load(): Promise<WordList> {
	const response = await fetch(`${base}/wordlist-zh.txt`);
	if (!response.ok) {
		throw new Error(
			`Could not load the Chinese word list (${response.status}). ` +
				'Without it this device cannot split Chinese into words.'
		);
	}

	return parseWordList(await response.text());
}

/**
 * Shared with the tests, which read the committed file from disk rather than over HTTP.
 *
 * Returns the `Set` rather than the narrower `WordList` the analyzer asks for. A `Set` satisfies
 * that interface, and callers who want to count or sample the words — the tests do both — should
 * not have to widen it back out again.
 */
export function parseWordList(text: string): Set<string> {
	const words = new Set<string>();
	for (const line of text.split('\n')) {
		// The file carries a comment header giving its source and licence.
		if (line === '' || line.startsWith('#')) continue;
		words.add(line);
	}
	return words;
}
