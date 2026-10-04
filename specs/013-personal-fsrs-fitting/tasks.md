# Tasks: Personal FSRS fitting with in-context outcomes

Inputs: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md),
[contracts](contracts/), [quickstart](quickstart.md), ADR-0037. Tests are mandatory for
scheduling logic (Constitution II): write each test first, watch it fail, then implement, then
mutate the implementation once to see the test go red. Synthetic activity only in the isolated
setup. Each story ends deployed and phone-checked (Constitution I).

## Phase 1: Setup

- [x] T001 Specify and clarify in specs/013-personal-fsrs-fitting/spec.md
- [x] T002 Plan and record ADR in specs/013-personal-fsrs-fitting/plan.md and docs/adr/0037-in-context-outcomes-and-fitted-rules.md

## Phase 2: Foundational

- [x] T003 Write a failing test that the latest `anki-parameters` across two device ids is chosen by `at`, then device id, then sequence, in tests/storage/memory.test.ts
- [x] T004 Fix the ordering in `currentParameters` and `recordParameters` (ORDER BY at DESC, device_id DESC, device_seq DESC) in src/lib/storage/repository.ts

## Phase 3: User Story 1 — Shown English never counts as understanding (P1)

Goal: `evidence-3` in production; undo tap; format-2 export; in-context outcomes reported.

Done 2026-10-04 with two simplifications: an undone tap is never written (the sheet is still open),
so the rule needs no undo filter; and format 2 is format 1's shape plus `helped` on exposures,
not a separate item stream (tests live in tests/domain/memory.test.ts rather than evidence.test.ts).
Independent test: quickstart Story 1 passes; Cards → Learning data shows card and in-context rows.

- [x] T005 [P] [US1] Write failing tests for helped spans in tests/domain/helped.test.ts: a `translation` encounter's offsets cover its words; a reveal with only `detail.line` maps to that line's range from the document text; an opening or later `setting` with `stage: true` and `blurEnglish: false`, or `showAllEnglish: true`, helps the whole session; a session with no setting counts as blurred
- [x] T006 [P] [US1] Write failing property tests (fast-check, `size: 'max'`) for `evidence-3` in tests/domain/evidence.test.ts: a helped `seen` never yields a Good; every lookup or check (any `knew` value) yields Again for both skills once per session; a `tap-undone` makes its tap vanish; a tap under shown English still yields Again; with no help and no checks the result equals `evidence-2`
- [x] T007 [US1] Implement `helpedSpans(session encounters, line ranges)` returning ranges or whole-session help in src/lib/domain/helped.ts
- [x] T008 [US1] Implement `evidence-3` in src/lib/domain/memory.ts: set `RULE = 'evidence-3'`; treat every `check` as a tap; drop taps followed in the same session by `tap-undone` for the same word and offsets; give a `seen` exposure its Good only when `exposure.helped` is false; extend `Exposure` with `helped: boolean`
- [x] T009 [US1] Write a failing storage test in tests/storage/helped.test.ts: a media session answered `all` with line 1 revealed exports line-1 words as helped and others not; memory of a line-1 word gains nothing from it
- [x] T010 [US1] In src/lib/storage/repository.ts `wordHistory`, compute `helped` per (session, word) with `helpedSpans` over the session's `translation` and `setting` encounters and the document's line ranges (split the stored text on `\n`), keeping exposures unhelped if any covering occurrence lies outside every helped span; include `tap-undone` encounters among events
- [x] T011 [US1] Add `cancel()` to `Recorder` that drops the pending tap and pushes `{ kind: 'tap-undone', lexemeId, documentId, fromOffset, toOffset }`; record every `closed()` as `lookup` (never `check`); add a recorder case to tests/storage/recorder.test.ts first, in src/lib/ui/recorder.ts
- [x] T012 [US1] Validate `tap-undone` (needs word and offsets) in src/lib/domain/encounter.ts with cases in tests/domain/encounter.test.ts
- [x] T013 [US1] Remove the "I knew it" button and add **Undo tap** (calls `onundo`) in src/lib/ui/StateMenu.svelte; wire `onundo={() => { recorder?.cancel(); menuClosed(); }}` and drop `onknew` in src/routes/read/[id]/+page.svelte
- [x] T014 [P] [US1] Write failing tests for format 2 and in-context outcomes in tests/domain/tuning.test.ts: outcome table of data-model.md (first tap per word per session = 0; unhelped reading `seen` in an `all` session with no tap = 1; listening never an outcome); metrics split by outcome type and skill; format 1 still validates
- [x] T015 [US1] Implement item stream and outcomes in src/lib/domain/items.ts and format 2 plus in-context metrics in src/lib/domain/tuning.ts per contracts/export-and-fit.md
- [x] T016 [US1] Export format 2 from `tuningDataset` (all words with review, tap or seen items) in src/lib/storage/repository.ts and extend tests/storage/tuning.test.ts first
- [x] T017 [US1] Show card and in-context rows per skill in src/routes/cards/tuning/+page.svelte; accept format 1 and 2 in scripts/fsrs/evaluate.mjs and document in scripts/fsrs/README.md
- [x] T018 [US1] Extend the `listened` scenario: reveal a line, finish "every unknown word", export, assert `helped` on that line's words; tap a word, Undo tap, assert `tap-undone` on Diagnostics, in scripts/verify-in-browser/harness.mjs
- [x] T019 [US1] Mutate the helped check (T008) and the undo filter (T008) once each, confirm red, restore; run full tests, type check, lint; record in specs/013-personal-fsrs-fitting/quickstart.md
- [ ] T020 [US1] Deploy; on the A71 check the word sheet (Undo tap, no "I knew it") and Learning data; update docs/current-state.md

## Phase 4: User Story 2 — Fit personal parameters on the laptop (P2)

Goal: one FSRS-6 engine for production and fit; `fit.mjs` produces a guarded ParameterSet.

Done 2026-10-04 with one change of design, measured first: production keeps ts-fsrs (due dates,
card states) and applies the rule strengths after each step; `replay.ts` reproduces its predictions
exactly with `fsrs6.ts` (tests/domain/replay.test.ts), instead of production delegating to the
engine. T028 is done except fitting the reader's real export, which is on the phone.
Independent test: quickstart Story 2 passes on a synthetic history and on the real export.

- [x] T021 [P] [US2] Write failing tests in tests/domain/fsrs6.test.ts: own steps (initial, recall, lapse, same-day, difficulty, retrievability) equal ts-fsrs `next_state`/`get_retrievability` to 1e-6 over fast-check histories with default and Anki weights
- [x] T022 [US2] Implement unrounded FSRS-6 steps and the `fit-1` item update (seen: Good step scaled by `seenReading`/`seenListening`; tap: Again step with stability × `tapStability`) in src/lib/domain/fsrs6.ts
- [x] T023 [US2] Write a failing test that the engine with the evidence-3 baseline set reproduces production `memoryOf` exactly over generated histories, in tests/domain/fsrs6.test.ts
- [x] T024 [US2] Switch `fold`/`memoryOf` in src/lib/domain/memory.ts to the engine, taking a `ParameterSet`; keep `ruleKey` = rule + set id
- [x] T025 [P] [US2] Write failing tests in tests/domain/fit.test.ts: (a) synthetic history generated from known parameters → fitted later log loss ≤ generating + 2% (SC-002); (b) 30 outcomes → `too little data`, not applicable; (c) identical output on repeated runs; (d) only earlier outcomes influence the fit (perturbing a later label leaves the fitted set unchanged)
- [x] T026 [US2] Implement in src/lib/domain/fit.ts: objective (card BCE + in-context BCE with P = a + (1−a−b)·R, prediction before application) + Gaussian prior (Anki weights centre, fsrs-rs σ; extras σ 0.5 around 1; a around 0.10, b around 0.05); projected Adam with central differences, clamps from `CLAMP_PARAMETERS`; 80/20 timestamp split; γ from {0.5, 1, 2, 4} on the earlier period's last fifth; bootstrap verdict per research R5; FR-012 `applicable`
- [x] T027 [US2] Add scripts/fsrs/fit.mjs per contracts/export-and-fit.md (loads src/lib/domain/fit.ts through Vite like evaluate.mjs) and document it in scripts/fsrs/README.md
- [ ] T028 [US2] Mutate the split (use all outcomes) and the reliability term once each, confirm red; time `fit.mjs` on the reader's real export (SC-003) and record counts per outcome type in specs/013-personal-fsrs-fitting/quickstart.md
- [x] T029 [US2] Deploy (done `7f767b2`; phone spot-check pending, no USB device) (memory now computed by the engine; expect no visible change); spot-check a few words' due dates on the A71 against the previous build; update docs/current-state.md

## Phase 5: User Story 3 — Apply a fitted set and roll back (P3)

Goal: append-only activations, guarded Apply, exact rollback, background recompute.

Done 2026-10-04 except T034 (phone). API names as built: `parametersInForce`, `applyParameters`,
`returnToParameters(id | null)` (null = the Anki weights), `parameterHistory`. Every activation
carries the whole set it puts in force (or null), so "in force" is the latest one by time.
Independent test: quickstart Story 3 passes; SC-004 and SC-005.

- [x] T030 [P] [US3] Write failing tests in tests/storage/activation.test.ts: apply then roll back → memory rows equal field for field (SC-004); non-applicable or `comparedWith` ≠ active id → refused; latest activation wins across two devices; restore keeps the active set; activation never alters encounters, reviews or marks
- [x] T031 [US3] Validate `fsrs-activation` in src/lib/domain/encounter.ts (well-formed ParameterSet, `apply|rollback`) with cases in tests/domain/encounter.test.ts
- [x] T032 [US3] Implement `activeSet()`, `applySet(set)` (checks FR-012 and `comparedWith`), `rollBackTo(id)` and `activations()` in src/lib/storage/repository.ts; `currentParameters` callers use `activeSet()`; wire through src/lib/storage/{client,protocol,worker}.ts
- [x] T033 [US3] Add Import fitted set, report, Apply (or the reason it is refused), history with Return to this set, and "updating memory…" until the sweep finishes, in src/routes/cards/tuning/+page.svelte per contracts/reader-apply.md
- [ ] T034 [US3] Isolated phone: import a synthetic applicable set, apply, time the sweep (SC-005, < 30 s), roll back; record in specs/013-personal-fsrs-fitting/quickstart.md and docs/current-state.md

## Phase 6: User Story 4 — Fit in Reader on the phone (P4)

Goal: the same fit in a supervised worker. Gate: T035's measurement.

2026-10-04: built and browser-checked before the phone measurement, because T035 needs the worker
and the button to measure at all. The fit was first made 14× faster on the laptop (research R4);
no reverse-mode tape. T035 measured 35 s on the A71; T038 agreement within 4.3e-8; cancel and
hide checked in the browser only.
Independent test: quickstart Story 4 passes; SC-006.

- [x] T035 [US4] Measure: a minimal worker running `fit.ts` on a synthetic history of the reader's export size on the A71 (isolated origin); record time and battery temperature in specs/013-personal-fsrs-fitting/research.md. If over 2 minutes, add a reverse-mode tape in src/lib/domain/fit.ts checked against finite differences in tests/domain/fit.test.ts, and measure again
- [x] T036 [US4] Implement src/lib/fit-worker.ts: runs `fit.ts` on the format-2 dataset under `inferenceBudget`, posts progress, terminates on cancel, page hide, 5-minute deadline or refused lease; nothing written until a finished result is shown
- [x] T037 [US4] Add Fit on this phone with progress and Cancel to src/routes/cards/tuning/+page.svelte, feeding the same report and Apply rule as an imported file
- [x] T038 [US4] On the A71 (isolated): fit, cancel mid-fit, hide mid-fit; compare with `fit.mjs` on the same export (agree within rounding); record SC-006 in specs/013-personal-fsrs-fitting/quickstart.md

## Phase 7: Polish

- [ ] T039 Update docs/current-state.md, scripts/verify-in-browser/README.md and docs/anticipated-changes.md with what shipped, measurements and open limits
- [ ] T040 Run the test-auditor agent over tests added by this spec and fix tests that cannot fail

## Dependencies

T003–T004 → US1 (T005–T020) → US2 (T021–T029) → US3 (T030–T034) → US4 (T035–T038) → T039–T040.
US3 needs US2's ParameterSet and engine; US4 needs US2's fit and US3's Apply. Within US1, T007
needs T005, T008 needs T006, T010 needs T007–T009, T015 needs T014, T016 needs T010 and T015.

## Parallel opportunities

- US1: T005, T006 and T014 (separate test files) together; T011–T013 (recorder, encounter,
  sheet) alongside T014–T015 (outcomes).
- US2: T021 and T025 together; T027 alongside T024 once T026 exists.
- US3: T030 alongside T031.

## Implementation strategy

MVP is US1: it fixes credit the reader considers wrong and starts collecting the right outcomes
now, which US2's verdict depends on. Ship each story before starting the next; US3's Apply will
refuse everything until about 100 later in-context outcomes exist, which is expected.
