# ADR-0027: An Encounter Log With Open Kinds; Memory Derived Through A Named Rule

**Status**: Accepted
**Date**: 2026-09-27
**Relates to**: spec 007, ADR-0003 (earned vs derived), register "Recording that a word was encountered"

## Context

Encounters are earned: no fold recovers one that was never written, and none have been written since
the reader started using the app daily. How much each kind of encounter should count towards a memory
is unknown, and will stay unknown until months of reviews exist to fit it against.

## Decision

- **Two append-only tables**: `session`, and `encounter` with a free-text `kind`, typed columns for
  what every event has (session, document, offsets, lexeme where there is one, media time, speed,
  text visibility, device order), and a JSON `detail` for the rest. Reviews are encounters. The
  attention answer is an encounter, since a session row is never updated.
- **Facts, not conclusions**: `lookup`, never `forgotten`.
- **Ranges, not per-word rows**: which words a range covered is derived from the current tokens.
- **Encounters share the device sequence** with status events: one order for the whole history.
- **Memory is derived**: a pure rule (`evidence-1`) maps a word's history to FSRS ratings, and ts-fsrs
  folds them. Each memory row records its rule. A new rule is a background recompute. The rows of
  the old rule stay in use until they are replaced (Principle VIII).
- **Deleting a document with history** removes its media and hides it. The text stays.

## Alternatives Rejected

- **A typed table per kind**: stricter, but each new kind of encounter is a migration of earned data.
- **Encounters in `status_event`**: its `asserted` is a judgment, and the state fold would misread
  them.
- **Storing FSRS state as earned**: freezes today's guess of how encounters count into the history.
- **One row per word shown**: millions of rows, frozen against a segmentation that will change.

## Consequences

- New kinds of encounter (a listening-card clip, a creator-aware rule) need no migration.
- `detail` fields are checked by the repository, not by SQLite: a validation bug could write a
  malformed detail. The per-kind validation is tested first.
- Fitting the rule later is a pure function over the log, measured against review outcomes.

## Amendment, 2026-09-27: `evidence-2`

On the reader's word, a word met untapped in a session answered "I tapped every word I didn't know"
is a Good, not a Hard, and it counts even for a word with no memory yet, which then starts one
(still not a card). The rule change is the recompute this ADR provides for. The memory sweep
also backfills words from earlier attentive sessions that `evidence-1` left without a memory,
Ignored words excepted. Measured on 10 videos (1,340 encounters): 223 words in 0.5 s on the laptop.
