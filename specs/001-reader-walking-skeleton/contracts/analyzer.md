# Contract: Analyzer (Language Provider Seam)

The first of Constitution Principle V's named seams. Slice 0 supplies its **second**
implementation, which is why this slice demonstrates the seam rather than asserting it: the
character splitter and a future real segmenter must both fit, and a boundary with one instance
proves nothing.

## Interface

```ts
export interface Analyzer {
  readonly name: string;        // recorded on every document it analyses
  readonly version: string;     // ditto — together these make re-derivation deliberate
  readonly language: string;

  analyze(text: string): Promise<AnalyzedToken[]>;
}

export interface AnalyzedToken {
  start: number;        // code-point offset, inclusive
  end: number;          // code-point offset, exclusive
  isWord: boolean;      // false for punctuation, whitespace, Latin runs
}
```

## Why `Promise`, when the only implementation is instant

Deliberate, and it is the one piece of shape in this slice not justified by slice-0 need.

Every analyzer this slice contains is pure and synchronous. Later ones are not: a small ONNX
sequence tagger loads a model, an LLM analyzer makes a network call that can fail part-way, and an
ensemble runs several sources and reconciles them. An interface written as synchronous would fit
none of these, and widening it later means changing every call site — cheap in effort, but the kind
of change that gets deferred and then constrains what gets built.

Under Principle V this passes the reversibility test on plausibility: the register rates an LLM
analyzer `high`, and the register is what authorises seam structure.

## Obligations on every implementation

1. **Tiling** — returned tokens are ordered, non-overlapping, gapless, and cover the input exactly.
   Concatenating `text.slice(start, end)` in code points reproduces `text`. This is FR-005 and it
   is the interface's central promise.
2. **Code points, never UTF-16 code units.** All offsets go through `domain/offsets.ts`.
3. **`isWord` is honest.** Punctuation, whitespace and Latin runs are tokens for tiling purposes
   but are not markable, so a word list is never polluted with items that cannot be studied.
4. **Empty input yields an empty array**, not an error.
5. **Deterministic for a given `(name, version)`.** Re-analysing unchanged text must produce
   identical tokens, or `analyzer_version` is not identifying anything.
6. **No storage, no DOM.** Text in, tokens out.

## Slice 0's implementation

`character.ts` — `name: "character-splitter"`, `version: "1"`. One token per Unicode code point.
`isWord` is true for characters in CJK ranges and false otherwise.

Deliberately weak. It exists to exercise the seam and to prove that swapping analyzers is a
recompute, not a migration. **It must not be improved**: a better placeholder makes the slice look
more finished while validating nothing extra.

## Not in this contract

No pronunciation, no part of speech, no gloss, no confidence, no alternative candidates. Each is a
real future need — the ensemble needs candidates, the register wants pronunciation and POS at
ingest — and each will widen `AnalyzedToken` additively when the implementation that produces it
exists. Adding fields no implementation populates would be the speculative generality Principle V
forbids.
