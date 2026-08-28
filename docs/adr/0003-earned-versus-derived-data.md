# ADR-0003: Earned Versus Derived Data

**Status**: Accepted
**Date**: 2026-08-28
**Relates to**: Constitution Principle V (amended v1.1.0 → v1.2.0);
[ADR-0001](0001-seam-placement-policy.md); [ADR-0002](0002-word-identity-and-token-model.md)

## Context

ADR-0001 established the reversibility test: a change is expensive to retrofit if deferring it
would require migrating populated tables, changing a persisted identifier, or changing an
external contract.

Applying that test during ADR-0002 exposed an imprecision. "Migrating populated tables" treats
all populated tables alike, but they are not alike. The `token` table is large and populated,
yet changing its shape costs nothing of consequence, because tokens are computed from source
text that is preserved verbatim — a better token model is obtained by recomputation. The
`word_status` table is smaller, and changing its shape is severe, because its contents exist
nowhere else and were accumulated over months of reading.

The distinction that matters is not whether a table holds rows. It is whether those rows could
be reproduced if deleted.

## Decision

Principle V's reversibility test is refined by a prior classification. All persisted data is
either:

- **Earned** — produced by the user's irreplaceable effort or by an external system of record.
  Word status, review history, notes, reading position, and anything imported from Anki. If
  deleted, it cannot be reconstructed.
- **Derived** — computed from earned data, source material, or reference data. Segmentation,
  tokens, pronunciations, definitions, frequency annotations. If deleted, it can be recomputed.

The rules follow:

1. Changes to **earned** data structure are EXPENSIVE by default. Hedge the schema per Principle
   V before the first row is written.
2. Changes to **derived** data structure are CHEAP by default, regardless of row count. Defer
   them. Recomputation is not migration.
3. Derived data is cheap **only while its inputs are retained**. Any pipeline that discards its
   input silently converts derived data into earned data. Inputs to derivation MUST therefore be
   preserved verbatim, and discarding one is a decision requiring an ADR.

Rule 3 is the load-bearing one: it is what makes the classification true rather than merely
convenient.

## Alternatives Rejected

**Leave ADR-0001's test as written.** Rejected because "migrating populated tables" gave the
wrong answer on the two largest tables in the design, in opposite directions — it would have
over-protected tokens and under-protected status history.

**Classify by table size or write frequency.** Rejected as uncorrelated with the actual cost.
Token counts exceed status counts by orders of magnitude while mattering far less.

**Replace the reversibility test entirely.** Rejected because the earned/derived distinction
does not cover persisted identifiers or external contracts, which remain expensive for reasons
unrelated to reproducibility. This refines the test; it does not supersede it.

## Consequences

**Easier.** Most retrofit-cost questions now have a mechanical answer — ask whether the data can
be recomputed — instead of requiring judgment the developer does not yet have. It also yields a
positive obligation that is easy to check: retain the inputs.

**Harder.** Storage grows, since raw source text is kept alongside everything derived from it.
This is accepted; text is small and the option it preserves is large.

**Revisit if.** Retained inputs become genuinely costly to store — plausible if video is added
later, where the input is not small. At that point rule 3 forces an explicit ADR rather than a
silent deletion, which is the intended behaviour.
