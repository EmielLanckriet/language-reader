# ADR-0030: A Session Can Be Withdrawn; Its Encounters Stay And Count For Nothing

**Status**: Accepted
**Date**: 2026-09-29
**Relates to**: ADR-0027 (the encounter log and memory derived from it); spec 007

## Context

A phone check of lookup speed tapped 12 words 35 times in a test copy of a video. Deleting the copy
kept "your marks and history in it", as it should for a real document: those lookups counted as the
reader's own, so FSRS took the 12 words as forgotten and made cards of them. The history is
append-only (ADR-0027): an encounter is never updated or deleted, and a copy restored elsewhere must
replay to the same memory.

## Decision

A session can be withdrawn. A `withdrawn` encounter joins it, with the reason; nothing is removed.
Memory is derived without any encounter of a withdrawn session: its lookups, checks and reviews,
its exposures, and its attention answer. Withdrawing recomputes every word the session touched.
Diagnostics lists deleted documents whose sessions still count, and "Forget" withdraws all of one's
sessions.

## Consequences

- **Easier**: a test, or a sitting the reader does not want counted, is taken back without breaking
  append-only history; a backup carries the `withdrawn` encounter like any other, so a restore
  derives the same memory.
- **Harder**: every query that feeds memory must leave withdrawn sessions out (`WITHDRAWN` in
  repository.ts); a new one that forgets to would count them again. The test "counts nothing a
  withdrawn session did" fails if the lookups, the exposures, or the recompute forget it.
- A build older than this one restores the encounter but does not know it, and counts the session.
- There is no undo of a withdrawal; it would be an encounter of its own if it is ever needed.
