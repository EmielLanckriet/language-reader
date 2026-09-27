# Implementation Plan: Flashcards That Know What I Read And Watched

**Branch**: `main` (spec `007-fsrs-flashcards`) | **Date**: 2026-09-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/007-fsrs-flashcards/spec.md`

## Summary

Record what happens while reading and watching as an append-only encounter log: sessions, ranges,
lookups, checks, replays, translations, settings, attention answers and reviews. From it, derive a
memory state per (word, skill) with ts-fsrs, through a named, versioned evidence rule, seeded from
Anki's stability, difficulty and last review. Colour words by today's recall, and add a flashcard
page for reading cards. Only the log is permanent; every memory row can be recomputed.

## Technical Context

**Language/Version**: TypeScript 6, Svelte 5 / SvelteKit (static), Python 3 for the laptop Anki script

**Primary Dependencies**: new: `ts-fsrs` 5.4.2 (R1). Existing: `@sqlite.org/sqlite-wasm`, opus-mt quick translator

**Storage**: SQLite in OPFS via the storage worker. Migration `003-encounters.sql` (data-model.md)

**Testing**: vitest + fast-check; `verify:browser` for the three reachable scenarios

**Target Platform**: the installed PWA on the reader's Android phone (Chrome)

**Project Type**: offline-first web app, no server

**Performance Goals**: lookup reflected in colour < 1 s (SC-004); next card < 0.5 s (SC-005); full recompute < 30 s on the phone (SC-006)

**Constraints**: ≤ 5 s of encounters lost on a kill (SC-002); reviewing fully offline (FR-023)

**Scale/Scope**: ~2,500 words with memory, ~70 documents, ~1,000 encounters per viewing hour

## Constitution Check

| Principle | Check |
|---|---|
| I. Ships to the phone | Quickstart's phone section, in one deploy. |
| II. Test-first | Test-first: the evidence rule and memory fold ("review scheduling logic"); encounter append and validation, and copy restore (irreversible surface: exact assertions, transactions); Anki provenance parsing. Recording hooks in the stage, the flashcard page and colouring get one plumbing test each, at most. Each test is mutated red once before it is kept. |
| III. Anki | **Amended** by ADR-0026 (1.5.0 → 2.0.0, MAJOR: redefined). The Reader schedules; Anki is a seed and is still never written. The export script still opens a copy read-only. |
| IV. Vertical | Each story spans the migration, the repository, the worker protocol and the UI. |
| V. Seams | No new seam. ts-fsrs is a pure library inside the domain core, like the analyzer's tables. Anticipated changes are recorded in ADR-0027 and the register. |
| VI. ADRs | ADR-0026 (reviewing moves in; Principle III), ADR-0027 (encounter log and derived memory). |
| VII. Readable | One rule function with a table-shaped body; no rule framework. |
| VIII. Fast first | Memory from an older rule stays in use while the sweep recomputes (R6). Colours are computed at draw time. |

Earned: `session`, `encounter`, `document.removed_at`, the new provenance fields. Derived: `memory`,
colours, the queue, card sentences.

Post-design re-check: passes. The one non-obvious case is FR-015's "Anki ignored after the first
review". It is a rule behaviour, not a write restriction, so a later rule can revisit it.

## Project Structure

### Documentation

```text
specs/007-fsrs-flashcards/
├── spec.md  plan.md  research.md  data-model.md  quickstart.md
├── contracts/evidence-rule.md  contracts/formats.md
└── tasks.md            (next: /speckit-tasks)
```

### Source Code

```text
src/lib/storage/migrations/003-encounters.sql   session, encounter, memory, document.removed_at
src/lib/storage/repository.ts    startSession, recordEncounters (batched), memoryFor, rebuildMemory,
                                 cardQueue (new/due), delete → remove; export/restore format 2
src/lib/storage/protocol.ts      the new calls
src/lib/storage/sweep.ts         recompute memory rows of an older rule
src/lib/domain/memory.ts         evidence rule + ts-fsrs fold + recall (pure; contracts/evidence-rule.md)
src/lib/domain/encounter.ts      encounter types, per-kind validation
src/lib/domain/anki.ts           provenance with d= and r=, format 2
src/lib/backup/format.ts         format 2 + upgrade 1→2
src/lib/ui/recorder.ts           session + 5 s chunk flushing, visibility/pagehide flush
src/lib/ui/MediaReader.svelte    emits played/seek/replay/translation/setting
src/routes/read/[id]/+page.svelte  lookups, checks, read ranges, attention sheet, recall classes
src/lib/ui/StateMenu.svelte      "I knew it"; plain-words memory (FR-018)
src/lib/ui/AttentionSheet.svelte
src/routes/cards/+page.svelte    flashcard page; TabBar gains "Cards"
scripts/anki/export_words.py     format 2
tests/domain/memory.test.ts  tests/storage/encounters.test.ts  tests/backup/format2.test.ts
```

**Structure Decision**: the existing single SvelteKit app. The domain logic sits in `src/lib/domain`,
kept pure by `tests/architecture/domain-purity.test.ts`.

## Complexity Tracking

None.
