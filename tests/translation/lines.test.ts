import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { englishFor } from '../../src/lib/translation/lines';

/**
 * Principle VIII's one hard rule for translation: the LLM's English is never shown under, or
 * replaced by, the quick model's. Arbitrary gaps on either side, since both arrive line by line.
 */
const line = fc.option(
	fc.string({ minLength: 1 }).filter((s) => s.trim() !== ''),
	{ nil: undefined }
);

describe('choosing each line’s English', () => {
	it('shows the LLM’s line wherever there is one, and the quick line only in its gaps', () => {
		fc.assert(
			fc.property(fc.array(line), fc.array(line), (llm, quick) => {
				const count = Math.max(llm.length, quick.length);
				englishFor(count, llm, quick).forEach((english, i) => {
					if (llm[i]) expect(english).toEqual({ text: llm[i]!.trim(), source: 'llm' });
					else if (quick[i]) expect(english).toEqual({ text: quick[i]!.trim(), source: 'quick' });
					else expect(english).toBeUndefined();
				});
			})
		);
	});
});
