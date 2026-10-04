/**
 * Runs the fit on this device under ADR-0032's bounds (spec 013 Story 4): it takes the local-model
 * lease, so it never runs beside speech or translation; it stops when cancelled, when the app is
 * hidden, or after five minutes; and a stopped fit leaves nothing behind.
 */

import { inferenceBudget } from '$lib/inference-budget';
import type { fitDataset } from '$lib/domain/fit';

export type FitResult = ReturnType<typeof fitDataset>;

const DEADLINE_MS = 5 * 60_000;

export function fitOnThisDevice(
	data: unknown,
	onProgress: (done: number, total: number) => void
): { result: Promise<FitResult>; cancel: () => void } {
	const lease = new AbortController();
	let stop: (why: string) => void = () => {};
	const result = new Promise<FitResult>((resolve, reject) => {
		let worker: Worker | undefined;
		let release: (() => void) | undefined;
		let deadline: ReturnType<typeof setTimeout> | undefined;
		const hidden = () => {
			if (document.visibilityState === 'hidden') stop('Stopped: the app was hidden.');
		};
		const finish = () => {
			worker?.terminate();
			clearTimeout(deadline);
			document.removeEventListener('visibilitychange', hidden);
			release?.();
		};
		stop = (why) => {
			lease.abort();
			finish();
			reject(new Error(why));
		};
		document.addEventListener('visibilitychange', hidden);
		inferenceBudget(lease.signal)
			.then((unlock) => {
				release = unlock;
				if (lease.signal.aborted) return finish();
				deadline = setTimeout(
					() => stop('Stopped: the fit took longer than five minutes.'),
					DEADLINE_MS
				);
				worker = new Worker(new URL('./fit-worker.ts', import.meta.url), { type: 'module' });
				worker.onmessage = (event) => {
					const message = event.data;
					if (message.type === 'progress') onProgress(message.done, message.total);
					else {
						finish();
						if (message.type === 'done') resolve(message.result);
						else reject(new Error(message.message));
					}
				};
				worker.onerror = (event) => {
					finish();
					reject(new Error(event.message || 'The fit stopped unexpectedly.'));
				};
				worker.postMessage(data);
			})
			.catch((error) => {
				finish();
				if (!lease.signal.aborted) reject(error);
			});
	});
	return { result, cancel: () => stop('Cancelled.') };
}
