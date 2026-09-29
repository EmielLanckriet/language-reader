import { SERVICE } from '$lib/media/service-address';

/** A model lease across Reader tabs. Callers release it only after freeing their worker. */
export async function inferenceBudget(signal: AbortSignal): Promise<() => void> {
	if (!navigator.locks) throw new Error('This browser cannot safely coordinate local models.');
	return new Promise((resolve, reject) => {
		void navigator.locks
			.request('reader-local-model', { signal }, async () => {
				const busy = () =>
					void fetch(`${SERVICE}/busy`, { method: 'PUT', signal: AbortSignal.timeout(2000) }).catch(
						() => {}
					);
				busy();
				const timer = setInterval(busy, 20_000);
				try {
					await new Promise<void>((release) => resolve(release));
				} finally {
					clearInterval(timer);
				}
			})
			.catch(reject);
	});
}
