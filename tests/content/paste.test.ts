import { describe, it, expect } from 'vitest';
import { pasteSource, MAXIMUM_CHARACTERS } from '../../src/lib/content/paste';
import { RejectedInput } from '../../src/lib/content/types';
import { codePointLength } from '../../src/lib/domain/offsets';

// FR-018 (rejected input explains itself) and FR-020 (the size limit).
//
// FR-020 was deliberately changed from "approximately 5,000 characters" to an exact number, on the
// grounds that an approximate limit has no testable boundary. This is that test. It did not exist
// until after the phone check, which is its own small lesson: making a requirement testable and
// then not testing it buys nothing.

const EXT_B = '\u{2000B}'; // 𠀋 — one character, two UTF-16 code units

function repeat(character: string, times: number): string {
	return character.repeat(times);
}

describe('pasting text', () => {
	it('keeps the content exactly as submitted, including whitespace (FR-002)', async () => {
		const text = '  我看书。\n\n  第二段落  ';
		const document = await pasteSource.ingest(text);
		// Not trimmed, not collapsed, not normalised. Everything derived is rebuilt from this, so a
		// source that quietly edits it turns derived data into earned data without saying so.
		expect(document.rawContent).toBe(text);
	});

	it('declares what kind of content it is', async () => {
		const document = await pasteSource.ingest('我看书');
		expect(document.contentType).toBe('text/plain');
		expect(document.language).toBe('zh');
	});

	it('titles the document from its opening', async () => {
		const document = await pasteSource.ingest('我看书。\n第二行');
		expect(document.title).toBe('我看书。');
	});

	it('shortens a long title rather than storing a paragraph', async () => {
		const document = await pasteSource.ingest(repeat('我', 100));
		expect(codePointLength(document.title)).toBeLessThan(100);
		expect(document.title.endsWith('…')).toBe(true);
	});

	describe('refusing input', () => {
		it('refuses empty text', async () => {
			await expect(pasteSource.ingest('')).rejects.toThrow(RejectedInput);
		});

		it('refuses whitespace alone', async () => {
			await expect(pasteSource.ingest('   \n\t  ')).rejects.toThrow(RejectedInput);
		});

		it('refuses something that is not text at all', async () => {
			await expect(pasteSource.ingest(42)).rejects.toThrow(RejectedInput);
		});

		it('says what was wrong, rather than failing silently (FR-018)', async () => {
			await expect(pasteSource.ingest('  ')).rejects.toThrow(/nothing to save/i);
		});
	});

	describe('the size limit (FR-020)', () => {
		it('accepts a document of exactly the limit', async () => {
			const document = await pasteSource.ingest(repeat('我', MAXIMUM_CHARACTERS));
			expect(codePointLength(document.rawContent)).toBe(MAXIMUM_CHARACTERS);
		});

		it('refuses one character over the limit', async () => {
			await expect(pasteSource.ingest(repeat('我', MAXIMUM_CHARACTERS + 1))).rejects.toThrow(
				RejectedInput
			);
		});

		it('states both the limit and the submitted size, so the reader can act', async () => {
			// FR-020 requires both numbers. "Too long" tells the reader nothing about how much to cut.
			const over = repeat('我', MAXIMUM_CHARACTERS + 250);
			await expect(pasteSource.ingest(over)).rejects.toThrow(/5,250/);
			await expect(pasteSource.ingest(over)).rejects.toThrow(/5,000/);
		});

		it('counts the limit in characters, not UTF-16 code units', async () => {
			// The decisive case. This is 5,000 characters and 10,000 code units: an implementation
			// using .length would refuse it, halving the real limit for anyone reading text with
			// rare hanzi in it — silently, and only for them.
			const astral = repeat(EXT_B, MAXIMUM_CHARACTERS);
			expect(astral.length).toBe(MAXIMUM_CHARACTERS * 2);

			const document = await pasteSource.ingest(astral);
			expect(codePointLength(document.rawContent)).toBe(MAXIMUM_CHARACTERS);
		});

		it('refuses astral text one character over the limit', async () => {
			await expect(pasteSource.ingest(repeat(EXT_B, MAXIMUM_CHARACTERS + 1))).rejects.toThrow(
				RejectedInput
			);
		});
	});
});
