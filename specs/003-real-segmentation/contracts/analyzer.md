# Contract: Analyzer (Language Provider Seam) — Slice 2 Revision

Supersedes nothing in
[slice 0's contract](../../001-reader-walking-skeleton/contracts/analyzer.md); it **adds** to it.
Every obligation there still holds. This document records what slice 2 adds and why.

Seam 1 now has its third implementation. Slice 0 argued the seam was demonstrated rather than
asserted because it had two; the third is the first one whose behaviour is not ours.

## Interface

```ts
export interface AnalyzedToken {
  start: number;        // CODE-POINT offset, inclusive
  end: number;          // CODE-POINT offset, exclusive
  isWord: boolean;      // markable, not "word-like"
}

export interface Analyzer {
  readonly name: string;
  readonly version: string;     // see "Version" below — may be derived, not declared
  readonly language: string;

  /** Characters this language may never split on inside a word. NEW in slice 2. */
  readonly unitDelimiters: ReadonlySet<string>;

  analyze(text: string): Promise<AnalyzedToken[]>;
  lexemeKey(surface: string): string;
}
```

## Obligations carried forward from slice 0

Unchanged and still binding: tiling, code-point offsets, honest `isWord`, empty input yields an empty
array, determinism for a given `(name, version)`, no storage and no DOM.

## New obligations in slice 2

### 8. Version MAY be derived, and MUST be honest

An analyzer whose behaviour is supplied by its host MUST NOT declare a hand-written version. It MUST
derive one from its own behaviour — a hash of its tokenisation of a fixed, committed probe string —
so that the stamp changes when the behaviour changes. See
[ADR-0011](../../../docs/adr/0011-analyzer-version-as-behaviour-fingerprint.md).

An analyzer whose behaviour lives in our code MAY keep declaring a version by hand.
`character-splitter` still does.

*Why this is an obligation and not an implementation note*: `analyzer_version` is what makes a
re-derivation deliberate. A version that cannot change when behaviour changes silently breaks
obligation 5 (determinism) across devices, and nothing detects it.

### 9. The delimiter set belongs to the provider

Each provider declares `unitDelimiters`: characters that **cannot occur inside a word in that
language**. Text is split into segmentation units on these before analysis, and no token may span a
unit boundary.

Admission rule, language-neutral: include a character only if it can never appear inside a word.
Where unclear, **exclude it** — a missed boundary only widens context and is harmless; a false
boundary can split a real word.

Chinese: line breaks and CJK sentence punctuation. **The ASCII full stop is excluded**, because in
Chinese it appears inside numbers, abbreviations and URLs. This exclusion is a fact about Chinese and
MUST NOT be copied to an alphabetic language, where the full stop is the sentence terminator. See
[ADR-0013](../../../docs/adr/0013-segmentation-unit-owned-by-language-provider.md).

Units MUST reassemble into the source exactly, with delimiters retained as non-markable tokens.
Tiling (obligation 1) is asserted over the **whole document**, which is what fails when a delimiter
set is wrong.

### 10. `isWord` is markability, never the platform's `isWordLike`

`Intl.Segmenter` reports `isWordLike`, and it is honest about what it means: `Python` and `3.14` come
back `true`. They are word-like and they are not Chinese vocabulary.

`isWord` MUST continue to mean "could the reader study this", which for Chinese is Han script.
Passing `isWordLike` through is a plausible-looking simplification that pollutes the word list, and
it is forbidden.

## Slice 2's implementation

`chinese.ts` — `name: "intl-segmenter-zh"`, `version:` a 16-hex-character behaviour fingerprint.

Wraps `new Intl.Segmenter('zh', { granularity: 'word' })`.

**The one dangerous line.** `Intl.Segmenter` reports `index` in **UTF-16 code units**. Measured on
`𠮷野家很好`: three tokens at indices 0, 2, 4, for a string of five code points. Every index MUST be
converted through `domain/offsets.ts` before it becomes a token offset.

This is the slice's highest-risk conversion because it is invisible: any text made only of
BMP characters produces identical results either way, and `status_event` offsets — **earned data** —
are anchored on character offsets. It MUST be tested with astral-plane input before the analyzer is
written.

**Locale note**, measured: `zh`, `zh-Hans`, `zh-CN`, `und` and even `en` all segment Chinese
identically, because ICU dispatches on script rather than locale. `zh` is passed explicitly anyway,
because relying on that would be relying on an implementation detail nobody promised.

## Candidates that do not implement this interface

The alternatives compared in slice 2 — CC-CEDICT longest match, a frequency-scored maximum-
probability path, jieba via Pyodide — deliberately do **not** implement `Analyzer` and do not live in
`src/`. They live in `scripts/compare-segmenters/`
([ADR-0012](../../../docs/adr/0012-candidate-comparison-runs-laptop-side.md)).

Making them implement the interface would be speculative generality of exactly the kind Principle V
forbids: an abstraction built for implementations that are not shipping. If one wins, it is written
against this contract at that point.
