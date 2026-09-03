# ADR-0013: The Segmentation Unit And Its Delimiters Belong To The Language Provider

**Status**: Accepted
**Date**: 2026-09-02
**Relates to**: Constitution Principle V (seam 1, language providers), spec
`003-real-segmentation` FR-002 to FR-005

## Context

Slice 2 segments a unit at a time rather than a whole document, bounded by line breaks and
sentence-final punctuation, so that no word is ever proposed across a boundary the writer put there.
The reader's primary intended content is subtitle and transcript lines, where this is the common
case rather than a corner.

That raised the question of punctuation that does not end a sentence — `3.14`, `U.S.`, a URL. The
first draft answered it with a rule that was silently Chinese-only: "the ASCII full stop is never a
delimiter". True for Chinese, where the terminator is 。and the ASCII stop appears inside numbers,
abbreviations and URLs. False for Dutch, the second language this project is built for, where the
ASCII full stop *is* the terminator and telling it from an abbreviation is a well-known hard problem.

## Decision

**The rule is language-neutral; the delimiter set is not, and belongs to the language provider.**

The rule every provider must satisfy: a character is admitted as a delimiter only if it cannot occur
inside a word in that language. Where that is unclear, the text is not split on it.

The Chinese provider's set is line breaks and CJK sentence punctuation, excluding the ASCII full
stop. That exclusion is a fact about Chinese and MUST NOT be generalised.

Segmentation units reassemble into the source, delimiters retained as non-markable tokens, and the
tiling obligation is asserted over the whole document rather than per unit.

## Alternatives Rejected

- **One shared delimiter set for all languages.** Rejected because any such set is wrong for at least
  one language: including the ASCII stop breaks Chinese decimals, excluding it breaks Dutch
  sentences.
- **Segment the whole document, no units.** Rejected because it permits words spanning a subtitle
  line, which is always an error, in the content type the tool is aimed at. Measured: unit splitting
  cost nothing (2.9 ms versus 3.8 ms on 5,000 code points) and produced identical tokenisation, so
  there is no quality-for-safety trade to make.
- **Detect sentence ends cleverly, with abbreviation lists or a model.** Rejected as unnecessary for
  Chinese and premature for Dutch. The asymmetry does the work instead: a missed boundary only widens
  context and is harmless, a false boundary can split a word, so doubt resolves toward not splitting.

## Consequences

**Easier.** Correctness does not depend on reasoning the delimiter set out correctly. Units
reassemble, so a wrong set breaks whole-document tiling and fails loudly in a property test rather
than producing subtly wrong words.

**Harder.** Adding Dutch now carries a known, named problem — sentence boundary detection for an
alphabetic language — rather than inheriting a rule that happens to work. This is recorded in the
anticipated-changes register so it arrives as scheduled work rather than as a surprise.

**Revisit if**: a language arrives whose word boundaries genuinely cross line breaks, which would
make the unit itself the wrong abstraction rather than the delimiter set wrong.
