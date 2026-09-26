---
description: "Tasks for 006 — the reader's Anki words as a starting point"
---

# Tasks: My Anki Words As A Starting Point

**Input**: `specs/006-anki-baseline/` — plan.md, spec.md, research.md, data-model.md,
contracts/anki-words.md, quickstart.md

**Tests**: Required. The import writes earned data, and the retraction changes the projection, both
on Principle II's mandatory list. Tests are written **first**, and each is **made to fail by a
mutation** before it is kept (CLAUDE.md). The picker and preview are glue: one browser scenario.

**Keep checks short**: fixtures of a handful of words; the real 2,128-word import only on the phone.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Create `scripts/anki/`, `tests/anki/` and `tests/fixtures/anki/` (a five-word `anki-words.json`, one word per level plus a duplicate)

---

## Phase 2: Foundational (blocks all stories)

- [X] T002 Test first, in `tests/anki/retraction.test.ts`: replaying a history whose last event for a word is `(none)` leaves that word with no state, for any history (fast-check), and a later judgment gives it one again
- [X] T003 Add the four Anki levels (`anki-learning` … `anki-long-term`, with labels "Anki: learning" …) and `RETRACTED = '(none)'` to `src/lib/domain/state.ts`; make `projectStates` drop a retracted word; make T002 pass, then fail it by mutation
- [X] T004 Make the repository's projection writes honour a retraction (delete the `word_state` row) in `writeProjectedState` and `rebuildProjection` in `src/lib/storage/repository.ts`; `exportBody`'s replay check and `restoreCopy` then agree by construction (one test in `tests/anki/retraction.test.ts` through the repository)

---

## Phase 3: User Story 1 — My Anki words are already marked (P1) 🎯 MVP

**Goal**: one import sets every studied word's Anki level, and never touches a word the reader marked.

**Independent test**: import the fixture into a library with one hand mark; the other four words have
their levels, the hand-marked word keeps its mark, and a word in no document has a state.

- [X] T005 [P] [US1] Level rules test first in `scripts/anki/test_export_words.py` (stability, the interval fallback, (re)learning, the strongest card per word), then `scripts/anki/export_words.py` per contracts/anki-words.md: copy + `-wal` to a temp dir, open read-only, write the file, print the counts, `--push` over adb
- [X] T006 [P] [US1] Test first in `tests/anki/plan.test.ts`: `planImport(file, currentStates)` in `src/lib/domain/anki.ts` returns, per word, the event to write or nothing, following research R6 (none → level; anki same → nothing; anki different → level; the reader's own → nothing), and refuses a `format` other than 1
- [X] T007 [US1] Test first in `tests/anki/import.test.ts`: `Repository.importAnki(file)` writes the plan in one transaction (a failure mid-way writes nothing), creates lexemes for words in no document, and tags each event `anki <exportedAt> s=<stability>`; then implement it in `src/lib/storage/repository.ts`
- [X] T008 [US1] Carry `importAnki` (a reader change) across `src/lib/storage/protocol.ts`, `worker.ts`, `client.ts`
- [X] T009 [US1] Diagnostics → Anki words in `src/routes/diagnostics/+page.svelte`: file picker, preview (profile, last changed, counts per level, words to set, words kept because the reader marked them), Import, result
- [X] T010 [P] [US1] The four levels' shades in `src/lib/ui/app.css` (learning warm, fading to a faint long-term, apart from the reader's own colours), and "from Anki, <date>" in the word sheet (`src/lib/ui/StateMenu.svelte`) when the state's provenance is Anki
- [X] T011 [US1] Browser scenario `anki` in `scripts/verify-in-browser/harness.mjs`: pick the fixture, check the preview counts, import, and see a word's shade in a document

**Checkpoint**: US1 alone gives the reader their baseline.

---

## Phase 4: User Story 2 — Re-import keeps up (P2)

- [X] T012 [US2] Tests in `tests/anki/import.test.ts`: importing the same file twice writes nothing the second time; a file with one word's stability changed writes exactly one event; a word the reader marked after the first import is left alone by the second

---

## Phase 5: User Story 3 — Undo an import (P3)

- [X] T013 [US3] Test first in `tests/anki/undo.test.ts`: `Repository.undoAnkiImport(id)` returns every word whose current state is from that import to its state before it (with that state's provenance) or retracts it; hand marks and words a later import changed are untouched; the history grows, never shrinks
- [X] T014 [US3] Implement `undoAnkiImport`, carry it across the worker boundary, and add "Undo this import" to Diagnostics

---

## Phase 6: Polish

- [X] T015 Run the real export on the laptop (checksum of `collection.anki2` before and after, SC-005) and the import on the reader's phone (SC-001, SC-002); record the counts in quickstart.md
- [X] T016 Update `docs/backlog.md` (a card reset in Anki keeps its last level; a live-recall display) and mark this spec's tasks done

## Dependencies

T002–T004 before any story. US1 (T005–T011) is the MVP. US2 is tests over US1's code. US3 needs T004's
retraction. T005 (laptop) and T006 (phone rules) can proceed in parallel.
