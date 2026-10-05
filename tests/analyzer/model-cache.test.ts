import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { cachesToDiscard, MODEL_CACHE } from '../../src/lib/analyzer/model-cache';

/**
 * Which caches a new build is allowed to throw away.
 *
 * The service worker's activation sweep deleted everything that was not the current precache,
 * which included the model cache — so accepting an update silently charged the reader another
 * 98 MB, contradicting the comment in model-cache.ts claiming it survives deploys. Nobody would
 * have seen it as a bug: the model would simply be gone, and the reader would be back on the
 * dictionary wondering why.
 *
 * Properties over arbitrary cache names rather than examples, because the interesting input is
 * "whatever happens to be on the device", not a list anyone thought of.
 */

// Cache names as they actually occur, plus arbitrary junk: names from other builds, and the two
// that mean something.
const anyName = fc.oneof(
	fc.string({ minLength: 1 }),
	fc.integer({ min: 0, max: 2_000_000_000_000 }).map((n) => `language-reader-${n}`),
	fc.constant(MODEL_CACHE)
);

describe('choosing which caches to discard on activation', () => {
	it('never discards the model cache', async () => {
		fc.assert(
			fc.property(fc.array(anyName), fc.string({ minLength: 1 }), (present, current) => {
				expect(cachesToDiscard([...present, MODEL_CACHE], current)).not.toContain(MODEL_CACHE);
			})
		);
	});

	it('never discards the precache the running build is using', async () => {
		fc.assert(
			fc.property(fc.array(anyName), fc.string({ minLength: 1 }), (present, current) => {
				expect(cachesToDiscard([...present, current], current)).not.toContain(current);
			})
		);
	});

	// 2026-10-06: two deploys minutes apart. Build B activated while build C had installed behind it,
	// and B's sweep deleted C's precache; accepting C then left a worker with nothing to serve, and
	// every deep link failed (ERR_FAILED), online too.
	it('never discards a newer build’s precache, which a waiting worker owns', async () => {
		const build = fc.integer({ min: 0, max: 2_000_000_000_000 });
		fc.assert(
			fc.property(fc.array(anyName), build, build, (present, current, other) => {
				const newer = `language-reader-${Math.max(current, other) + 1}`;
				expect(cachesToDiscard([...present, newer], `language-reader-${current}`)).not.toContain(
					newer
				);
			})
		);
	});

	it('discards everything else, so old builds do not accumulate', async () => {
		const build = fc.integer({ min: 0, max: 2_000_000_000_000 });
		fc.assert(
			fc.property(fc.array(anyName), build, (present, n) => {
				const current = `language-reader-${n}`;
				const newer = (name: string) => Number(/^language-reader-(\d+)$/.exec(name)?.[1] ?? -1) > n;
				const discarded = new Set(cachesToDiscard(present, current));
				for (const name of present) {
					const kept = name === current || name === MODEL_CACHE || newer(name);
					expect(discarded.has(name)).toBe(!kept);
				}
			})
		);
	});

	it('returns only names that were present', async () => {
		fc.assert(
			fc.property(fc.array(anyName), fc.string({ minLength: 1 }), (present, current) => {
				for (const name of cachesToDiscard(present, current)) {
					expect(present).toContain(name);
				}
			})
		);
	});
});
