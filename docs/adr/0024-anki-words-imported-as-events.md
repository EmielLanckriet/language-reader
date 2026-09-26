# ADR-0024: Anki Words Are Imported As Events, With Anki's Own Levels

**Status**: Accepted
**Date**: 2026-09-26
**Relates to**: spec 006, Constitution Principle III, ADR-0003 (earned data), ADR-0006 (Anki
boundary), spec 005 (copies)

## Context

The reader has 2,128 studied words in Anki (FSRS stability from hours to years) and wants the Reader
to start from them, reflecting Anki's own view of each card rather than a known/learning split.
Word states are a projection of an append-only event log with a free-text provenance; the backups of
spec 005 copy that log.

## Decision

- **A laptop script reads a copy of the collection read-only** and writes `anki-words.json`, with the
  level computed from stability: learning (<1 week, or in (re)learning), young (1–3 weeks), mature
  (3 weeks–1 year), long-term (>1 year). Anki is never opened for writing, by anything in this project.
- **An import is ordinary events** with provenance `anki <importId> s=<stability>`, in one
  transaction. Four new state names (`anki-learning` … `anki-long-term`) sit beside the reader's own
  four and are shown in their own shades.
- **The reader's own judgment always wins**: an import writes nothing for a word whose current state
  has any other provenance. Re-importing writes only what differs.
- **Undo appends**: the state each word had before, or a new **retraction** event (`asserted` =
  `(none)`) that the projection turns into "never judged". Nothing is deleted from the history.

## Alternatives Rejected

- **Mapping onto known/learning**: the reader rejected it; it discards the strength that tells a
  fragile word from a solid one.
- **A live recall chance (shading by today's retrievability)**: more faithful, harder to read at a
  glance; kept possible by storing stability with each judgment.
- **An import table** (a migration and a copy-format version) for facts the provenance holds.
- **Deleting an import's events to undo it**: history is append-only, and copies already hold them.
- **The `anki` library or AnkiConnect**: a dependency, or a live Anki with writes one call away.

## Consequences

- Backups and restores carry imports without change.
- The retraction is a new event kind every future reader of the log must understand; the projection
  is its one interpreter.
- A card reset or deleted in Anki leaves its last imported level in the Reader until the reader marks
  the word; noted, not handled.
