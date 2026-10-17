/** Word lookup against CC-CEDICT, loaded the first time a word is looked up. */

import { base } from '$app/paths';
import type { Entry, Part } from './gloss';

export type { Entry, Part };

// The dictionary lives in its own worker: only a word and its few entries cross to the page.
let worker: Worker | undefined;
let nextId = 0;
const pending = new Map<number, { resolve: (parts: Part[]) => void; reject: (e: Error) => void }>();

function dictionary(): Worker {
	if (worker) return worker;
	worker = new Worker(new URL('./dictionary-worker.ts', import.meta.url), { type: 'module' });
	worker.onmessage = (event) => {
		const { id, parts, error } = event.data;
		const call = pending.get(id);
		pending.delete(id);
		if (error === undefined) call?.resolve(parts);
		else call?.reject(new Error(error));
	};
	worker.onerror = (event) => {
		// A worker that failed to start answers nothing: fail what waits, and start afresh next time.
		for (const call of pending.values())
			call.reject(new Error(event.message || 'the dictionary stopped'));
		pending.clear();
		worker?.terminate();
		worker = undefined;
	};
	return worker;
}

/** What the word means: see gloss.ts for how a word the dictionary lacks is explained. */
export function lookUp(word: string, readings?: string[]): Promise<Part[]> {
	return new Promise((resolve, reject) => {
		const id = nextId++;
		pending.set(id, { resolve, reject });
		const url = new URL(`${base}/dictionary-zh.txt`, location.href).href;
		dictionary().postMessage({ id, url, word, readings });
	});
}
