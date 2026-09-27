---
description: "Tasks for 007 — flashcards that know what I read and watched"
---

# Tasks: Flashcards That Know What I Read And Watched

**Input**: `specs/007-fsrs-flashcards/` — plan.md, spec.md, research.md, data-model.md,
contracts/evidence-rule.md, contracts/formats.md, quickstart.md

**Tests**: required where Principle II requires them: the encounter log (earned data, the
irreversible surface), the evidence rule, memory fold and card queue ("review scheduling logic"),
and the copy format. They are written **first**, and each is **made to fail by a mutation** before it
is kept (CLAUDE.md). Recording hooks, pages and colours are glue: one plumbing test or browser
scenario each, no more.

**Keep checks short**: fixtures of a few words and a 90 s clip. The real 2,128-word seed and
full-library recompute run only on the phone (T037).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Add `ts-fsrs@5.4.2` to `dependencies` in `package.json`; check `npm run build` passes `scripts/check-bundle.mjs` with it
- [X] T002 [P] Fixtures: US1 builds its library with `buildHistory` (tests/backup/support.ts) rather than a fixture directory; the Anki v2 fixture comes with T018

---

## Phase 2: Foundational (blocks all stories)

- [X] T003 Migration `src/lib/storage/migrations/003-encounters.sql` per data-model.md: `session`, `encounter` (indexes and unique `(device_id, device_seq)`), `memory`, `document.removed_at`; register it in `MIGRATIONS` in `src/lib/storage/db.ts`
- [X] T004 [P] Test first in `tests/domain/encounter.test.ts`: `validateEncounter` in `src/lib/domain/encounter.ts` accepts each kind of data-model.md with its required fields; refuses a `lookup`/`check` without lexeme or offsets, a `review` without `detail.skill` and a grade 1–4, a `played` without `toMs`, and an `attention` whose answer is not `all`/`some`/`none`/`null`; accepts an unknown kind. Then implement the types and the validator
- [X] T005 Test first in `tests/storage/encounters.test.ts`: `Repository.startSession(documentId, modality)` and `Repository.recordEncounters(sessionId, encounters[])`:
  - append in one transaction: a refused encounter in a batch writes none of the batch;
  - take `device_seq` from the counter `status_event` uses, so a mark and an encounter never share a number;
  - never update or delete a row (fast-check over interleaved marks and batches: the table only grows, and orders exactly by `(device_id, device_seq)`).

  Then implement them in `src/lib/storage/repository.ts`
- [X] T006 Carry `startSession` and `recordEncounters` across `src/lib/storage/protocol.ts`, `worker.ts` and `client.ts`

**Checkpoint**: encounters can be written and are ordered with the rest of the history.

---

## Phase 3: User Story 1 — What I look up and replay is remembered (P1) 🎯 MVP

**Goal**: every encounter of FR-001 is recorded as it happens, and survives a kill and a restore.

**Independent test**: quickstart phone step 1. The session's encounters on Diagnostics are exactly
what was done, in order, and nothing else in the app changed.

- [X] T007 [US1] `src/lib/ui/recorder.ts`: one recorder per open document. It starts the session on the first range, buffers encounters, and flushes every 5 s, on pause, seek, `visibilitychange` to hidden and `pagehide` (research R3). It exposes `lookup`, `check`, `replay`, `translation`, `setting`, `seek`, `attention`, `rangeFrom/rangeTo`
- [X] T008 [US1] `src/lib/ui/MediaReader.svelte` reports to the recorder:
  - played chunks with media time, speed and whether the line's text is showing;
  - seeks with from/to;
  - `replay()` with `toPrevious`;
  - a translation opened (line, source);
  - speed and stop-after-line changes.
- [X] T009 [US1] `src/routes/read/[id]/+page.svelte`:
  - start a recorder per document (modality `media` or `reading`);
  - a tap that shows a word's meaning records `lookup` (lexeme, offsets, and media time, speed and text visibility on video);
  - in texts, record the lines on screen ≥ 2 s as `read` ranges.
- [X] T010 [P] [US1] "I knew it" in `src/lib/ui/StateMenu.svelte`: it turns that lookup into a `check` via the recorder, and closes the sheet
- [X] T011 [P] [US1] `src/lib/ui/AttentionSheet.svelte`: shown on leaving a session with ≥ 30 s read or played (the back link, tab changes, `beforeNavigate`), with three answers and a dismiss, recorded as `attention` (research R13)
- [X] T012 [US1] One plumbing test in `tests/storage/recorder.test.ts`: a recorder driven through a lookup, a replay and 12 s of played ranges against an in-memory repository writes those encounters in order, and flushing twice writes nothing twice. Break the flush once to see it go red
- [X] T013 [US1] Test first in `tests/backup/format2.test.ts`: copy format 2 per contracts/formats.md:
  - `upgrade()` turns a format-1 body into 2 with empty arrays;
  - `exportBody` then `restoreCopy` into an empty database reproduces every session and encounter (words as `(language, surface)`, sessions re-linked);
  - restoring twice duplicates nothing.

  Then implement it in `src/lib/backup/format.ts` and `src/lib/storage/repository.ts`
- [X] T014 [US1] Delete keeps history (research R11): `Repository.removeDocument(id)` sets `removed_at` when any status event or encounter points at the document, and deletes outright otherwise. `listDocuments` hides removed documents. The delete button in `src/routes/read/[id]/+page.svelte` removes the media files in both cases. Add one test to `tests/storage/encounters.test.ts`
- [X] T015 [P] [US1] Diagnostics lists the latest sessions and their encounters (kind, word, line, media time, speed, text visible, answer), for quickstart step 1: `src/routes/diagnostics/+page.svelte`, plus a `recentEncounters` read call across the worker
- [X] T016 [US1] Browser scenario `encounters` in `scripts/verify-in-browser/harness.mjs`: open the fixture clip, look up a word, replay, seek, leave and answer. Diagnostics shows the five encounters

**Checkpoint**: US1 alone stops the data loss. Deploy it to the phone as soon as it passes (Principle I).

---

## Phase 4: User Story 2 — Words coloured by how well I still know them (P2)

**Goal**: a memory per (word, skill), derived through `evidence-1` and seeded from Anki, shown as
today's recall everywhere.

**Independent test**: spec story 2. After a seed, three words show three shades. A lookup of the
long-term word changes its shade everywhere.

- [X] T017 [P] [US2] Test first in `scripts/anki/test_export_words.py`, then change `scripts/anki/export_words.py`: format 2 adds `difficulty` (card `data.d`, else null) and `lastReview` (newest `revlog.id` of the card, ISO, else null); still read-only from a copy (contracts/formats.md)
- [X] T018 [P] [US2] Test first in `tests/anki/plan.test.ts`, then change `src/lib/domain/anki.ts`:
  - `parseAnkiExport` accepts formats 1 and 2;
  - `ankiProvenance` writes `s= d= r=`;
  - a new `ankiSeedOf(provenance)` reads both provenance forms (format 1 → difficulty 5, date unknown);
  - an unchanged re-import still writes nothing.
- [X] T019 [US2] Test first in `tests/domain/memory.test.ts`, per contracts/evidence-rule.md obligations 1, 3, 4, 5, 6 and research R5: one example test per row and per limit of the evidence table, plus fast-check that the fold is deterministic and depends on history order, not on the order the list arrives in
- [X] T020 [US2] Implement `src/lib/domain/memory.ts` (`evidenceFor`, `foldMemory`, `recall`, `RULE = 'evidence-1'`) over ts-fsrs with fuzz off and short-term on (research R1), until T019 passes. Mutate each limit once
- [X] T021 [US2] Test first in `tests/storage/memory.test.ts`: every event that touches a word recomputes that word's `memory` rows in the same transaction as the event:
  - a lookup, check or review touches its word;
  - an attention answer touches the words in its session's ranges that have memory;
  - an Anki import touches its words.

  `rebuildMemory()` from an empty table gives exactly the incrementally built rows (SC-007, fast-check over random histories). Then implement it in `src/lib/storage/repository.ts`, reading a word's history with its range intersections (research R4, R6)
- [X] T022 [US2] Rule change without a wait (Principle VIII): the sweep in `src/lib/storage/sweep.ts` recomputes rows whose `rule` ≠ `RULE` a batch at a time, while old rows stay readable. Run it after a restore too
- [X] T023 [US2] `getStates` also returns each word's memory (stability, difficulty, last_at, due, card, per skill), across `protocol.ts`, `worker.ts` and `client.ts`
- [X] T024 [US2] Colours by recall (research R7): compute the band per word at draw time with `recall()`, and add classes `recall-1`…`recall-4` in `src/lib/ui/app.css` for texts and in `src/lib/ui/MediaReader.svelte` for the stage. Hand-mark classes remain for words with no memory, and the Anki-level classes are no longer applied. The page refreshes the tapped word's memory after a lookup (SC-004)
- [X] T025 [P] [US2] Plain words in `src/lib/ui/StateMenu.svelte` (FR-018): "Reading: 92% today, next review in 12 days · Listening: —", and where it came from (Anki <date>, n reviews, n lookups)

**Checkpoint**: the scheduler's view is visible on every page. Batch with US3 for the phone.

---

## Phase 5: User Story 3 — I review my words in the Reader (P3)

**Goal**: a flashcard page for due and new reading cards, whose grades are encounters.

**Independent test**: spec story 3, and quickstart phone step 4.

- [X] T026 [US3] Test first in `tests/domain/queue.test.ts`: `cardQueue(memories, counts, reviewedToday, cap, now)` in `src/lib/domain/queue.ts` (research R8):
  - reviewed due cards come first, most overdue first, then Anki-seeded due cards, then new cards ranked by library frequency;
  - new cards are capped at `cap` minus the cards first reviewed today;
  - an ignored word is never in the queue;
  - a card beyond the cap is still a card tomorrow.

  Then implement it
- [X] T027 [US3] Test first in `tests/storage/cards.test.ts`: `Repository.cardSentence(lexemeId)` returns the line containing the first lookup, and on later reviews another occurrence whose line differs from the last review's (research R9). Then implement it, with `Repository.cardsToday(cap)` over `cardQueue` and the library's token counts
- [X] T028 [US3] `Repository.recordReview(lexemeId, grade, shownOffsets)` writes a `review` encounter and recomputes the word's memory in the same transaction (covered by T021's test with one added case), and is carried across the worker
- [X] T029 [US3] `src/routes/cards/+page.svelte`:
  - the counts (due, new) before the first card;
  - the word highlighted in its sentence;
  - tap to reveal pinyin and meaning (`lookUp`) and the translation (the media line's stored English, else the quick model for that sentence, else nothing);
  - Again/Hard/Good/Easy, with the next card at once;
  - an Again comes back in the session;
  - works offline.
- [X] T030 [P] [US3] "Cards" tab in `src/lib/ui/TabBar.svelte`; the daily new-card cap as a setting on the cards page (`localStorage`, default 10)
- [X] T031 [US3] Browser scenario `cards` in `scripts/verify-in-browser/harness.mjs`: seed the fixture with an Anki import and one lookup, open Cards, grade Again and then Good, and see the lookup word's shade change on its document

**Checkpoint**: reviewing works without Anki.

---

## Phase 6: Polish & Cross-Cutting

- [X] T032 [P] Measured (research R14) with a throwaway vitest harness over the real Anki export; not kept in scripts/measure, since the phone numbers are the ones that decide
- [X] T033 [P] `docs/backlog.md`: listening cards need a brainstorm (sentence as the test, word as the memory, a new clip each review, creator as source difficulty); the register's rows for creator and speed as covariates and for fitting `evidence-*` to review outcomes
- [X] T034 [P] Update `specs/006-anki-baseline` references where display by Anki level is now superseded (FR-012 of 006 → spec 007 FR-016), in one line in its spec's header
- [ ] T035 Run the test-auditor agent over the new tests (tests that cannot fail, properties true by construction)
- [X] T036 `npm run check`, `npm run lint`, `npm test`, and only the `verify:browser` scenarios `encounters` and `cards` plus the existing media and reading scenarios
- [ ] T037 Phone, one deploy (quickstart phone steps 1–6): export Anki format 2 and import it, then check SC-001 to SC-006 and the delete behaviour. Record the measured numbers in `specs/007-fsrs-flashcards/quickstart.md`

---

## Dependencies

- Setup → Foundational → US1 → US2 → US3. US2 needs the encounters of US1 for lookups and
  attention; US3 needs US2's memory.
- Within US1: T007 before T008, T009, T010 and T011; T013 and T014 are independent of the UI.
- Within US2: T017 and T018 are independent of T019–T020; T021 needs T020; T024 needs T023.
- Within US3: T026 before T027; T028 before T029.

## Parallel examples

- **US1**: T010, T011 and T015 in parallel once T007 exists; T013 alongside the UI tasks.
- **US2**: T017 (Python), T018 (anki.ts) and T019 (memory tests) in parallel.
- **US3**: T030 alongside T029.

## Implementation strategy

1. **MVP = US1**, deployed on its own. It is the only part that loses data for every day it waits.
2. US2 and US3 go to the phone together in one deploy (CLAUDE.md: batch phone checks).
3. The rule `evidence-1` is expected to change. Don't polish it; T032's measurement and later
   review outcomes decide what `evidence-2` is.
