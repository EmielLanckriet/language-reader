/**
 * Fits personal parameters off the main thread (spec 013 Story 4): the same `fitDataset` as
 * scripts/fsrs/fit.mjs, on the same export, so the phone and the laptop agree. Supervised by
 * fit-run.ts, which may terminate it at any moment; it writes nothing.
 */

import { fitDataset } from './domain/fit';

self.onmessage = (event: MessageEvent<unknown>) => {
	try {
		const result = fitDataset(event.data, {
			onProgress: (done, total) => self.postMessage({ type: 'progress', done, total })
		});
		self.postMessage({ type: 'done', result });
	} catch (error) {
		self.postMessage({
			type: 'error',
			message: error instanceof Error ? error.message : String(error)
		});
	}
};
