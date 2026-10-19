# Tasks: Word status

**Input**: [spec.md](spec.md), [plan.md](plan.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/status-records.md](contracts/status-records.md)

**Tests**: required by the constitution (Principle II: status transitions, status event replay,
review scheduling). Each test task is run red before its implementation task, and each rule is
mutated once to see its test fail.

## Phase 1: Setup

- [X] T001 Write characterization tests of today's rule in `tests/domain/legacy-active.test.ts`: for histories built with the existing helpers in `tests/domain/memory.test.ts` — known word (2 attentive sessions, never tapped), Anki seed in the top 2,000 under 14 days, seed at 30 days, set-aside seed under and over 14 days, hand retire at 22 days, `learning` mark only, tapped and never reviewed, reviewed on Cards, drilled to 20 days — assert today's `isActive(memoryOf(h).reading)` combined with `card || known` (as `cardQueue` filters). Run green against the current code; these pin the old rule before it changes.

## Phase 2: Foundational (blocks every story)

- [X] T002 Write `tests/domain/status.test.ts` (red): `replayStatuses` returns the latest change per word in `(deviceId, deviceSeq)` order and nothing for a word without changes; `validateStatusChange` refuses an unknown status or cause and `stable`/`first-review` with a status other than `active`.
- [X] T003 Add `activation` cases to `tests/domain/status.test.ts` (red): `stable` at 14 days, not at 13.9; seed alone at 14 days activates; after a reader retire at 200 days no activation until stability dipped under 14 after the retire and rose back to 14; a reader retire at 5 days activates at the next 14; `first-review` for a Cards review after the latest status change and after the switch, not for one before either, not for a drill review; nothing for `active` or `ignored`; property (fast-check, `size: 'max'` with explicit `maxLength`): for any trajectory, `activation` returns nothing when the current status is `active` or `ignored`.
- [X] T004 Implement `src/lib/domain/status.ts`: `STATUSES`, `CAUSES`, `StatusChange`, `replayStatuses`, `validateStatusChange`, `activation(input)` per research R2–R3, `ACTIVE_AT_DAYS` moved here from `memory.ts`. T002–T003 green; mutate the dip condition and the switch bound once each.
- [X] T005 Implement `src/lib/domain/legacy-active.ts`: `legacyActive(history, parameters, strengths)` reproducing today's `card`/`known`/`setAside`/`retired`/stable flags and `isActive`, copied from `memory.ts` and `queue.ts` before they change; point T001 at it as well as at today's code; green.
- [X] T006 Add `src/lib/storage/migrations/006-word-status.sql` (`status_change`, its lexeme index, `word_status`) per data-model.md, and register it in `src/lib/storage/db.ts`; extend `tests/storage/migration.test.ts` for version 6.
- [X] T007 Write `tests/storage/status.test.ts` (red): `setStatus` appends one `reader` change and updates `word_status` in one transaction; `rebuildStatuses` changes nothing; `getStatuses` defaults to `retired`; an invalid status is refused and writes nothing.
- [X] T008 Implement in `src/lib/storage/repository.ts`: `appendStatusChange` (log first, then projection, device counter in the same transaction), `setStatus(lexemeId, status)`, `getStatuses(ids)`, `rebuildStatuses()`; expose `setStatus` and `getStatuses` in `src/lib/storage/protocol.ts`, `worker.ts`, `client.ts`. T007 green.
- [X] T009 Change `src/lib/domain/memory.ts`: `memoryOf` returns, beside each skill's memory, the reading fold's trajectory (position, stability after it, Cards review or not, the seed's stability first); drop `card`, `known`, `setAside`, `reviewed` from `Memory` and `card`, `known`, `setAside`, `retired` from `WordEvidence`; `evidenceFor` reads marks only for the Anki seed (no `ignored` return, no `learning`); `RULE = 'evidence-5'`, `ACTIVATION` out of `ruleKey`. Update `tests/domain/memory.test.ts`: remove flag assertions, add a test that a history with an `ignored` mark keeps its evidence.
- [X] T010 In `recomputeMemory` (`src/lib/storage/repository.ts`) write `card` and `reviewed` as 0, and after each word call `activation` with its trajectory, statuses and the switch position, appending what it returns — the only caller of `activation` and the only writer of `stable`/`first-review` (FR-005). Skip while the switch has not run. Add to `tests/storage/status.test.ts` (red first): reading a word past 14 days makes it active (`stable`); a first Cards review of a tapped retired word makes it active (`first-review`); a drill grade under 14 days does not; an active word tapped down to 1 day stays active; an ignored word past 14 days stays ignored.

## Phase 3: User Story 5 — the switch (P1; before the stories, since a phone without it shows empty Cards)

- [X] T011 [US5] Write the switch tests in `tests/storage/status.test.ts` (red): a library seeded with a known word, a seed under 14 days, set-aside words under and over 14, a hand retire at 22 days, `learning`/`known`/`unknown` marks, an Anki import undone by `(none)`, and a set-aside ended by `(none)`: after `switchToStatuses()`, `active`/`carried-over` exactly for the words `legacyActive` calls active; no mark asserting `ignored`, `learning`, `known`, `unknown`, `retired`; the set-aside's `(none)` gone, the import's `(none)` kept; `word_state` equals its replay; one `status-switch` encounter with the counts; a second call changes nothing; the hand-retired word at 22 days is active after the next recompute.
- [X] T012 [US5] Implement `switchToStatuses()` in `src/lib/storage/repository.ts` per research R4 (stored rows under the old rule key, else `legacyActive`; one transaction), the `status-switch` kind in `src/lib/domain/encounter.ts`, and call it in `take()` in `src/lib/storage/worker.ts` before `ensureMemory()`. T011 green.
- [X] T013 [US5] Backup format 4 in `src/lib/backup/format.ts` (`statuses`, upgrade 3 → 4 adds `[]`) and in `exportBody`/`restoreCopy` (export refuses when `word_status` is not the replay; restore replays, checks, then runs `switchToStatuses()` when the copy has no `status-switch` encounter). Tests in `tests/storage/status.test.ts` (red first): a format 4 copy restores every status exactly; a format 3 copy restored runs the switch.
- [X] T014 [US5] Remove `retireIgnored` and `setAsideAnki` from `src/lib/storage/repository.ts`, `protocol.ts`, `worker.ts`, `client.ts`, the call in `src/routes/+layout.svelte`, and their tests `tests/storage/retire-ignored.test.ts`, `tests/storage/set-aside.test.ts` (their remaining meaning is covered by T011).

## Phase 4: User Story 1 — Cards shows active words and the day's new words (P1)

- [X] T015 [US1] Update `tests/domain/queue.test.ts` and `tests/storage/cards.test.ts` (red): due = active and due (a retired due word is not, the known-word case is neither due nor new); new = tapped, retired, with a sentence, frequency order, budget less first reviews today; ignored never.
- [X] T016 [US1] Rewrite `cardQueue`/`isActive` in `src/lib/domain/queue.ts` to take each card's status; rewrite `cardsToday` in `src/lib/storage/repository.ts` to join `word_status` and the tapped words (drop `MET_WORDS`' set-aside path); `isDueWord` in `src/lib/domain/shares.ts` takes the status. T015 green.

## Phase 5: User Story 2 — activation stays in one place (P1)

- [X] T017 [US2] Add to `tests/storage/status.test.ts`: putting a parameter set in force that raises retired words past 14 days activates them in the sweep, and no active word becomes retired; a withdrawn session that had raised a word past 14 days leaves it active.
- [X] T018 [US2] Check by `grep` that `stable` and `first-review` are written only in `recomputeMemory`'s call of `activation`; note it in the ADR's How if not already true.

## Phase 6: User Story 3 — Retire and Ignore by hand (P1)

- [X] T019 [US3] `src/lib/domain/shares.ts` `kindOf`: recall only (no marks, no `ignored`); `src/lib/content/story.ts` and `src/lib/domain/hardcore.ts` callers adjusted; `tests/domain/shares.test.ts` updated (red first: an ignored word with memory counts by recall).
- [X] T020 [US3] Cards (`src/routes/cards/+page.svelte`): Retire and Ignore on both faces, Undo restoring the previous status via `setStatus`.
- [X] T021 [P] [US3] Hardcore drill (`src/routes/hardcore/[session]/+page.svelte`): Retire and Ignore with Undo; an ignored word leaves the queue.
- [X] T022 [P] [US3] Word sheet (`src/lib/ui/StateMenu.svelte`, `src/routes/read/[id]/+page.svelte`, the player's sheet wiring): Retire and Ignore toggles from the word's status; taking one back restores the previous status.
- [X] T023 [P] [US3] Progress detail (`src/lib/ui/WordDetailSheet.svelte`) Retire and Ignore; word list (`src/lib/ui/word-list.ts`, `src/lib/ui/WordList.svelte`) shows the status as deck status and only Anki levels as marks; `tests/storage/word-list.test.ts` updated.
- [X] T024 [US3] `src/lib/domain/state.ts`: no hand state offered; keep the names as history (comment), `ignored` and `retired` removed from the offered list.

## Phase 7: User Story 4 — hardcore leaves out ignored words (P2)

- [X] T025 [US4] `tests/storage/hardcore.test.ts` (red): an ignored due word is not planned and not drilled at the drill's start; a retired due word is. Implement in the hardcore planning and the drill start's re-classify (`src/routes/document/[id]/hardcore/+page.svelte`, `src/routes/hardcore/[session]/+page.svelte`, repository `hardcoreWords`).

## Phase 8: Polish

- [X] T026 Run on the 2026-10-16 backup (temporary test, removed afterwards): after restore and the switch, active = 2,111 + 丁, and no mark other than Anki levels and `(none)` remains.
- [X] T027 Browser scenarios `cards`, `study`, `hardcore`, `wordlist`, `sheet` updated and run (isolated, `npm run build`).
- [X] T028 Docs: ADR-0039, 0040, 0041 headers say amended by ADR-0044; `docs/anticipated-changes.md` spec 019 rows; `docs/current-state.md` entry; the switch-time count of the phone read before the update.
- [X] T029 `npm test`, `npm run check`, lint, `node scripts/check-bundle.mjs`; commit and push to main; deploy; phone round per quickstart.md (with "Just curious").

## Dependencies

T001 → T005. T002–T004 → T010. T006 → T008 → T010 → T011–T013. US5 (T011–T014) before US1–US4,
since every screen reads `word_status`. T019 before T020–T023. T026–T029 last.

## Parallel

T002/T003 with T006; T021, T022, T023 with each other after T019–T020.

## Strategy

One deploy (the reader chose one spec): every phase is built and checked on the laptop, then one
phone round. MVP order if it had to stop early: Phases 1–4.
