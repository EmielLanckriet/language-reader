# ADR-0003: Earned Versus Derived Data

**Status**: Accepted
**Date**: 2026-08-28
**Relates to**: Constitution Principle V (amended v1.1.0 → v1.2.0); ADR-0001; ADR-0002

## Context

ADR-0001 established a reversibility test: a change is expensive to retrofit if it would require
migrating populated tables, changing a persisted identifier, or changing an external contract.
That test is serviceable but imprecise. Applying it during the word-identity design (ADR-0002)
exposed the imprecision — it rates *any* schema change as expensive, which is wrong, and it
offered no way to distinguish two cases that behave completely differently:

- **Word status** is accumulated by the user over months. It exists nowhere else. If its key is
  wrong, there is no recovery.
- **Tokens** are the output of a segmenter run over source text. If the token model is wrong, the
  tokens are discarded and recomputed. Nothing is lost.

Both are populated tables. Under the v1.1.0 test both rate expensive, and the recommendation
would have been to hedge both. That would have meant building a span-list token model up front
for a case (discontiguous words) that v1 does not handle — precisely the speculative structure
Principle V exists to prevent.

The distinction that actually predicts retrofit cost is not whether data is persisted. It is
whether it can be regenerated.

## Decision

Persisted data is classified as **earned** or **derived**, and the reversibility test is applied
to that classification rather than to persistence.

**Earned data** is produced by the user or by an irreproducible external process. It cannot be
recomputed from anything the system retains. Examples: word status, review history, user notes,
reading position, anything imported from the Anki collection. Decisions about the shape of earned
data are one-way doors and MUST be settled before the data starts accumulating.

**Derived data** is computed from inputs the system preserves. It can be discarded and rebuilt.
Examples: tokens, segmentation, pronunciation annotations, dictionary joins, frequency rankings,
computed statistics. Changing the shape of derived data is a recompute, not a migration, and MUST
be deferred under Principle V.

**Corollary — preserve the inputs.** Derived data is only cheap to change while its inputs are
retained. Source text MUST be preserved verbatim, and any parameters needed to reproduce a
derivation (analyzer name and version, per ADR-0002) MUST be recorded alongside the output. A
derivation whose inputs were discarded has silently become earned data.

## Alternatives Rejected

**Keep the v1.1.0 test unchanged and rely on judgment for individual cases.** Rejected because
the developer is explicitly building architectural judgment rather than exercising it, and
case-by-case judgment in that position resolves toward whatever an implementing agent proposes.
ADR-0001 rejected this reasoning for seam placement; it applies here for the same reason.

**Classify by table rather than by field.** Rejected as too coarse. A single table can hold both:
`token` is derived, but if a user could annotate a token directly, that annotation would be
earned and would constrain the table.

**Treat all persisted data as earned, to be safe.** Rejected. This is the v1.1.0 behaviour, and
it is the failure mode this ADR exists to correct: it licenses hedging everywhere, which is
design-up-front wearing a safety argument.

## Consequences

**Easier.** The test now gives different answers for cases that genuinely differ, and it gives
them mechanically rather than by taste. It supplies a positive reason to preserve source text and
record analyzer versions, which previously read as unmotivated caution. It correctly permitted
single-span tokens in ADR-0002 while correctly forbidding a surface-form status key.

**Harder.** Every persisted field now needs a classification, and the classification is a
judgment that can be got wrong. The corollary adds a standing obligation: retaining inputs and
recording derivation parameters, without which the classification quietly becomes false.

**Revisit if.** Data classified as derived turns out in practice not to be regenerable — for
instance because an analyzer version becomes unavailable, or a derivation depends on a network
service whose responses change. That would mean the classification is aspirational rather than
factual, and reproducibility of derivations would need to become an enforced requirement rather
than an assumed property.
