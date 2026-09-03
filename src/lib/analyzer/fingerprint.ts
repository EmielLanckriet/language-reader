/**
 * Deriving an analyzer's version from how it actually behaves (ADR-0011).
 *
 * Slice 0 records `analyzer` and `analyzer_version` on every document, and that stamp is what makes
 * replacing an analyzer a deliberate recompute rather than an untraceable change. It works when the
 * analyzer knows its own version.
 *
 * `Intl.Segmenter` does not. Its behaviour comes from whatever ICU the browser embeds; there is no
 * version to read, and Chrome on Android is not the Node on this laptop. Writing `version: "1"`
 * would be false in the one direction that cannot be recovered from: two devices, or one device
 * before and after a browser update, would stamp different tokenisations identically, and documents
 * segmented under two different ICUs would sit mixed in one library with no way to tell them apart.
 *
 * So the version is a hash of the analyzer's own output over a fixed probe. When ICU changes, the
 * fingerprint changes, documents stop matching their stamp, and the re-derivation this slice builds
 * brings them up to date on its own. Drift becomes ordinary work rather than silent inconsistency.
 */

/**
 * The text every analyzer is fingerprinted against.
 *
 * Deliberately built from the spans that segmenters *disagree* about, measured in research.md R1:
 * a compound that gets split (自行车), a number-and-measure-word run that gets misread (三个人), a
 * name absent from any dictionary (玛丽亚), and the classic context-dependent boundary
 * (结婚的和尚未结婚的人, where 和尚 is the trap). A probe of easy text would hash identically across
 * ICU versions that differ on exactly the cases worth detecting.
 *
 * **Changing this string is equivalent to renaming the analyzer.** Every document's stamp becomes
 * stale at once and the whole library re-derives. That is occasionally the right thing to do and it
 * is never a casual edit.
 */
export const PROBE =
	'我在中国学习中文。他骑自行车去上班。三个人在那里，玛丽亚是我的朋友。结婚的和尚未结婚的人。花钱买花。';

/** One token as a platform segmenter reports it: a position and the text at it. */
export interface ProbeToken {
	index: number;
	segment: string;
}

/**
 * A short hash of a tokenisation, used as an analyzer's version.
 *
 * FNV-1a rather than a cryptographic hash, for one plain reason: `version` is a synchronous
 * property on the analyzer interface, and the platform's own hashing (`crypto.subtle.digest`) is
 * asynchronous. Nothing here needs cryptographic strength — the job is to notice when a segmenter
 * starts behaving differently, not to resist anyone forging a version. A collision would mean two
 * genuinely different ICU behaviours producing the same 32-bit value, which for the handful of ICU
 * builds this will ever meet is not a risk worth trading a synchronous interface for.
 *
 * Boundaries are hashed as well as text, because the two are the whole point: 中 / 国人 and
 * 中国 / 人 concatenate to the same string and are different segmentations.
 */
export function fingerprintOf(tokens: readonly ProbeToken[]): string {
	const shape = tokens.map((token) => `${token.index}:${token.segment}`).join('|');

	// FNV-1a, 32-bit. Written out rather than pulled in: it is six lines, and a dependency for six
	// lines is a dependency to justify at every upgrade.
	const OFFSET_BASIS = 0x811c9dc5;
	const PRIME = 0x01000193;

	let hash = OFFSET_BASIS;
	for (const character of shape) {
		hash ^= character.codePointAt(0) ?? 0;
		hash = Math.imul(hash, PRIME);
	}

	// `>>> 0` reads the accumulator as unsigned; Math.imul leaves it signed.
	return (hash >>> 0).toString(16).padStart(8, '0');
}
