/**
 * What the contextual segmenter needs on the device, named in one place.
 *
 * Shared by the store that fills this cache and the service worker that serves out of it. Two
 * copies of a cache name is one typo away from a cache nobody reads.
 *
 * The runtime is listed here rather than left to the precache deliberately (ADR-0015). It is
 * excluded from the install because it is useless without the model — but it is *equally* useless
 * for the model to be present without it, so the two are fetched together, kept together, and
 * discarded together. Anything else leaves a reader who downloaded on wi-fi and then went offline
 * holding a 98 MB model they cannot run.
 */

/** Not versioned by build: this survives deploys, unlike the precache. */
export const MODEL_CACHE = 'language-reader-model-v1';

/** Paths relative to the application base. Served from our own origin, so cacheable properly. */
export const RUNTIME_PATHS = ['/ort/ort-runtime.js', '/ort/ort-runtime.wasm'] as const;

/** Everything under here is served from {@link MODEL_CACHE} rather than from the precache. */
export const RUNTIME_PREFIX = '/ort/';

/**
 * Which of the caches on the device a newly activated build should throw away.
 *
 * Here rather than inline in the service worker because the sweep there was one line — delete
 * every cache that is not the current precache — and that line deleted the model cache too. The
 * comment above `MODEL_CACHE` claimed it survives deploys; it did not. Nobody would have reported
 * it as a bug either: accepting an update would simply have charged the reader another 98 MB and
 * dropped them back to dictionary segmentation, with nothing on screen to say why.
 *
 * The precache is named for its build, so every other `language-reader-<build>` really is rubbish
 * and should go. Exactly two names are load-bearing, and this is the one place that knows both.
 */
export function cachesToDiscard(present: readonly string[], keepPrecache: string): string[] {
	return present.filter((name) => name !== keepPrecache && name !== MODEL_CACHE);
}
