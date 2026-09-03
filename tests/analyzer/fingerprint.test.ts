import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { PROBE, fingerprintOf } from '../../src/lib/analyzer/fingerprint';

// An analyzer whose behaviour is supplied by the host cannot declare a version (ADR-0011).
// `Intl.Segmenter` exposes no ICU version, and the ICU in Chrome on Android is not the ICU in Node
// here. A hard-coded version would be false in the damaging direction: two devices would stamp
// different tokenisations with the same version, and nothing would ever detect it.
//
// So the version is derived from behaviour. These tests fix what "derived from behaviour" has to
// mean for that to be worth anything.

/** Stands in for a segmenter, so the properties can be tested without depending on ICU. */
function tokensOf(...segments: string[]) {
	let index = 0;
	return segments.map((segment) => {
		const token = { index, segment };
		index += segment.length;
		return token;
	});
}

describe('the analyzer fingerprint', () => {
	it('is stable across repeated calls on the same tokenisation', () => {
		const tokens = tokensOf('我在', '中国', '学习');
		expect(fingerprintOf(tokens)).toBe(fingerprintOf(tokens));
	});

	it('is stable across separately constructed but identical tokenisations', () => {
		expect(fingerprintOf(tokensOf('我在', '中国'))).toBe(fingerprintOf(tokensOf('我在', '中国')));
	});

	it('changes when the segmentation changes', () => {
		// The case this exists for: an ICU update that starts splitting a compound differently.
		const before = fingerprintOf(tokensOf('自行车', '很', '快'));
		const after = fingerprintOf(tokensOf('自行', '车', '很', '快'));
		expect(after).not.toBe(before);
	});

	it('changes when only the boundaries move, not the text', () => {
		// Concatenating the segments gives the same string in both cases, so a fingerprint over the
		// text alone would miss this — and this is precisely what a segmenter change looks like.
		const before = fingerprintOf(tokensOf('中', '国人'));
		const after = fingerprintOf(tokensOf('中国', '人'));
		expect(after).not.toBe(before);
	});

	it('is a short, stable-width hex string', () => {
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom('我', '中国', '学习', '。', 'a'), { maxLength: 20 }),
				(segments) => {
					const fingerprint = fingerprintOf(tokensOf(...segments));
					expect(fingerprint).toMatch(/^[0-9a-f]{8,16}$/);
				}
			)
		);
	});

	it('ships a probe long enough to exercise the disagreements that matter', () => {
		// A probe of only easy text would hash identically across ICU versions that differ on the
		// hard cases, which are the ones that change. These are the spans research.md measured as
		// contentious: compounds, names, and context-dependent boundaries.
		for (const contentious of ['自行车', '三个人', '玛丽亚', '结婚的和尚未结婚的人']) {
			expect(PROBE).toContain(contentious);
		}
	});
});
