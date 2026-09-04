# ADR-0016: A Document May Be Mid-Upgrade, And Says So With Two Stamps And A Boundary

**Status**: Accepted
**Date**: 2026-09-04
**Relates to**: ADR-0011 (analyzer version as behaviour fingerprint), ADR-0013 (segmentation unit),
spec `003-real-segmentation` FR-016 to FR-021, and research.md R18 and R20

## Context

Slice 2 ships a contextual model that costs about 4 s per 1,000 characters, against a dictionary
that costs 26 ms for 5,000. T080 made import use the dictionary and left the model to a background
sweep, which fixed SC-004. On the phone the sweep then never visibly arrived: every document stayed
on dictionary segmentation.

Reading the code found three causes, and the third is the one that needs a decision.

1. The awaits inside `taggedAnalyzer.analyze` yield **microtasks only**, so a 5,000-character
   document is one 27-second block of the main thread rather than thirty small ones. Measured, in
   `scripts/measure/yield.mjs`: a timer scheduled before an await-only loop does not run until the
   loop ends. Nothing paints and no tap is answered for the whole pass.
2. The reader's page loads tokens once, so an upgrade that does land is invisible until the document
   is closed and reopened.
3. **`rederiveDocument` writes once, at the end.** A pass interrupted at 26 seconds — the phone
   locked, the app backgrounded, the tab reloaded because it appeared hung — discards all 26
   seconds and starts from zero next time. A document that never gets one uninterrupted foreground
   window on a phone is a document that stays on the dictionary forever.

Fixing (3) means a document can be *partly* upgraded, and that collides with the invariant ADR-0011
rests on: a document's stamp names what produced its tokens. Half a document's tokens from the model
and half from the dictionary makes any single stamp a lie, and a lie of exactly the kind ADR-0011
exists to prevent — one no later reader could detect.

## Decision

**A document may be mid-upgrade, and records it: `upgrade_analyzer`, `upgrade_version`, and
`upgraded_through`, a character offset.**

The invariant is one sentence, and it is what keeps every token honestly stamped:

> Tokens before `upgraded_through` came from the upgrade analyzer. Tokens from `upgraded_through`
> onward came from the analyzer in `analyzer` / `analyzer_version`.

`upgraded_through` is always a segmentation-unit boundary (ADR-0013). Since no analyzer's token may
span a unit boundary, no token can straddle the line, so every token falls unambiguously on one side
and the invariant is decidable per token rather than approximate.

When `upgraded_through` reaches the end of the document, the upgrade analyzer becomes the document's
stamp and the upgrade record clears — in the same transaction as the last batch, so no state exists
in which a fully upgraded document still claims to be mid-upgrade.

Progress is discarded rather than trusted when the upgrade analyzer is not the one now in force. A
partial prefix from a superseded model is not a head start; it is tokens from an analyzer nobody
asked for, and ADR-0011 says the answer to that is to recompute.

The batch is bounded by **measured elapsed time, not character count**. The phone is the oracle and
its speed is not knowable here.

## Alternatives Rejected

- **Per-token analyzer stamp.** The fully general answer: every token row records what produced it.
  Rejected as paying for generality nobody needs. An upgrade advances front to back, so provenance
  is always a prefix, and a prefix is one integer rather than a column on every one of a document's
  several thousand token rows.
- **Leave the whole-document write, just make it faster.** Nothing available makes it fast. Batching
  the model does not help — cost is linear per character, measured (research.md R18) — and threads
  need `SharedArrayBuffer`, which needs COOP/COEP headers, which GitHub Pages does not set.
- **Write the upgraded prefix without recording where it ends.** The cheapest change, and wrong: the
  sweep could not resume, and `checkTiling` would pass on a document whose stamp described a
  quarter of its tokens. The whole point of the boundary is that the claim stays checkable.
- **Keep a second copy of the document's tokens while upgrading, and swap at the end.** Atomic, and
  it preserves the single stamp. Rejected because it makes the reader wait for the whole document
  before seeing any of it, which is the thing being fixed — the reader watching a page they are
  actually reading get better is the point, not an incidental benefit.
