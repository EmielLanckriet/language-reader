# ADR-0026: Reviewing Moves Into The Reader; Anki Becomes A Seed

**Status**: Accepted
**Date**: 2026-09-27
**Relates to**: Constitution Principle III (amended, 1.5.0 → 2.0.0), spec 007, ADR-0024, ADR-0006

## Context

The reader wants what happens while reading and watching (lookups, replays, how attentively they
followed) to shape when a word is next reviewed. Anki's scheduler cannot be told any of it, and
Principle III forbids writing its scheduling state. The register had deferred "build our own FSRS
scheduler" to this point. It warned that keeping both review queues is worse than either alone.

## Decision

- **Reviewing happens in the Reader**, scheduled by FSRS (ts-fsrs) over the Reader's own history.
- **Anki is a seed.** Each imported word starts from its Anki stability, difficulty and last review.
  After a word's first in-app review, later imports no longer change its schedule.
- **Anki is still never written**, by anything: not its cards, its scheduling, or its parameters.
- **Principle III is redefined** (MAJOR, 2.0.0): "Anki is authoritative" becomes "Anki is read, never
  written". The Reader owns scheduling.

## Alternatives Rejected

- **Only new words in the Reader, Anki words stay in Anki**: two review places, and encounters would
  have no effect on the 2,128 words the reader meets most.
- **Export new cards to Anki**: keeps AnkiDroid, but encounters cannot move a schedule, which was the
  point.
- **Writing review results back to Anki**: exactly the silent, unrecoverable corruption Principle III
  exists to prevent.

## Consequences

- AnkiDroid's review screen and the nightly `sentencegen` enrichment are given up for review.
- Scheduling becomes earned history in the Reader (reviews), so the copies of spec 005 matter more.
- If in-app reviewing proves worse, going back is possible: Anki was never touched, and it resumes
  from where the reader left it, only staler.
