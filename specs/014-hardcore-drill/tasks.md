# Tasks: Hardcore mode — drill a fragment's words around watching it

Inputs: [spec](spec.md), [plan](plan.md), [research](research.md), [data model](data-model.md),
[contract](contracts/hardcore-records.md), [quickstart](quickstart.md), ADR-0041. Tests are
mandatory for the memory rule and earned records (Constitution II): write each test first, watch it
fail, implement, then mutate the implementation once and see it go red. Parts and filters are
derived: properties, not expected values. UI is exempt; one browser scenario guards the plumbing.
Synthetic activity only in the isolated setup. One deploy and one phone round at the end (the
reader chose one spec, not slices).

## Phase 1: Setup

- [x] T001 Specify and clarify in specs/014-hardcore-drill/spec.md
- [x] T002 Plan and record ADR in specs/014-hardcore-drill/plan.md and docs/adr/0041-hardcore-drill-reviews.md

## Phase 2: Foundational (earned shapes and the memory rule, before any row is written)

- [x] T003 [P] Write failing cases in tests/domain/encounter.test.ts: `hardcore-plan` without non-empty `parts` (each `lines: [first, last]` with first ≤ last, `words` an array of numbers) or with `steps` empty or outside {preview, watch-first, drill, watch-after} is refused; `hardcore-step` needs `part` (number), `step` (one of the four), `at` (start|end); `hardcore-watch` needs `session`, `part`, `step`; a `review` with `detail.hardcore` needs `hardcore.part` a number and `detail.line` `[from, to]` with from ≤ fromOffset and toOffset ≤ to; a Cards review without them still passes
- [x] T004 Add the three kinds to `EncounterKind` and their validation, and the hardcore review checks, in src/lib/domain/encounter.ts until T003 passes
- [x] T005 [P] Write failing exact tests for the memory rule in tests/domain/memory.test.ts (helper: a review event with `detail: { skill: 'reading', grade, hardcore: { part: 0 }, line: [0, 10] }`): (a) a word with no history drilled Good once has a reading memory with `card` false and `reviewed` false; (b) a word with one lookup then a drill keeps `card` true and `reviewed` false (stays a candidate); (c) drills Good on days 0, 1, 4, 12, 30 until reading stability ≥ 14 give `card` and `reviewed` true from that review on, and a later Again leaves both true (sticky); (d) one drill then enough attentive `seen` exposures to reach stability ≥ 14 also drills it in; (e) reading alone reaching ≥ 14 with no drill does not; (f) a set-aside word (retired, provenance from `setAsideProvenance(2000)`) drilled once keeps `setAside`, and once drilled in loses it; (g) a seeded word reviewed on Cards, then drilled, has the same due date as if both were Cards reviews; (h) `ruleKey()` contains `drill-14`
- [x] T006 Implement in src/lib/domain/memory.ts until T005 passes: `export const DRILLED_IN_DAYS = 14`; `ACTIVATION = 'known-2+drill-14'`; a helper `isHardcore(event)` (`event.kind === 'review' && event.detail.hardcore !== undefined`); exclude hardcore reviews from `found.card`, from set-aside's `reviewedSince`, and from `memoryOf`'s `reviewed`; mark reading evidence from hardcore reviews (`Evidence.hardcore?: true`) and let the reading fold report whether, at or after the first hardcore evidence, stability reached `DRILLED_IN_DAYS`; a drilled-in word gets `card: true`, `reviewed: true`, no `setAside`; comment the decision once (ADR-0041)
- [x] T007 Mutation check for T005/T006: remove each hardcore exclusion (card, reviewed, reviewedSince) in turn, set `DRILLED_IN_DAYS` to 0, and make drilled-in depend only on the final stability; record which tests went red in specs/014-hardcore-drill/quickstart.md
- [x] T008 [P] Write failing storage tests in tests/storage/hardcore.test.ts (use tests/storage/support.ts): `cardsToday`'s first reviews today count a Cards review but not a hardcore review recorded today (FR-015), and a word drilled yesterday counts on its first Cards review today
- [x] T009 In `cardsToday` (src/lib/storage/repository.ts, the `firstReviewsToday` query near line 2076) take `MIN(at)` only over reviews with `json_extract(detail, '$.hardcore') IS NULL`, until T008 passes

## Phase 3: User Story 1 — Drill a fragment's words with its own sentences (P1) — MVP

Goal: from a document's page, start a session (one part, chosen fragment and steps), drill its
words with its own lines and audio, Again 3 cards later, every grade recorded at once.
Independent test: quickstart Browser with steps = drill only; the recorded reviews match the
grades given, one per grade.

- [x] T010 [P] [US1] Write failing tests in tests/domain/hardcore.test.ts for the drill queue and the next step: `drillQueue(ids)`; `afterGrade(queue, grade)` removes the head on 2–4 and moves it 3 places back on 1 (last when fewer remain); fast-check (`size: 'max'`): the queue empties only after every id was graded 2–4 once, and never loses or duplicates an id; `nextStep(plan, stepRecords)` is the first (part, step) in plan order without an `end` record, undefined when all ended
- [x] T011 [P] [US1] Write failing property tests in tests/domain/hardcore.test.ts for `drillWords(lines, tokens, words, options)`: every result word is drillable (class new, due, not-active or set-aside, never active-not-due or retired by hand) and occurs in the fragment; each word appears once; its card line is its first line in the part; order `frequency` is non-increasing in fragment occurrences (ties by first occurrence), `story` by first occurrence
- [x] T012 [US1] Implement `drillQueue`, `afterGrade`, `nextStep`, `drillWords` (one part, no filters yet) in src/lib/domain/hardcore.ts with types `HardcoreOptions`, `Plan`, `Part { lines: [number, number]; words: { lexemeId: number; line: number }[] }`, `Step = 'preview' | 'watch-first' | 'drill' | 'watch-after'`; lines from `lineRangesOf` (src/lib/domain/helped.ts) — until T010/T011 pass; mutate the Again offset once
- [x] T013 [US1] Classify words in the domain (`classify(state, reading, now)` in src/lib/domain/hardcore.ts, the shares' `kindOf` for known; exact cases in tests/domain/hardcore.test.ts), and add to src/lib/storage/repository.ts (wired through protocol, worker, client): `hardcoreSession(sessionId)` (document, plan, step records in order), `drilledSince(since)` (words graded 2–4 in a drill, not withdrawn), `frequencyRanks(lexemeIds)`; `startSession` takes a `SessionKind` (`hardcore`); tests in tests/storage/hardcore.test.ts. States and memory come from the existing `getStates`/`getMemory`, as the library's shares do.
- [x] T014 [US1] Extract the card faces from src/routes/cards/+page.svelte into src/lib/ui/CardFace.svelte: props `{ lexemeId, word, sentence: CardSentence, english? }`, events `ongrade(grade)`, `onretired(lexemeId)`; it keeps reveal, pinyin, dictionary, example audio (`prepareExample`, `timedExample`), Hear word/sentence, Retire with Undo; Cards keeps its queue, `cardSentence` and `recordReview`; verify with `npm run verify:browser -- cards cardaudio cardlayout`
- [x] T015 [US1] Add a **Hardcore** link to src/routes/document/[id]/+page.svelte (videos and texts) to `/document/[id]/hardcore`
- [x] T016 [US1] Create src/routes/document/[id]/hardcore/+page.svelte: fragment as From the beginning / Continue (only when `resumeOf` gives a line > 0, media only) / From–to (two line pickers over the document's lines with times for videos); steps as four toggles (all on); shows the drill word count; Start = `startSession(id, 'hardcore')`, record `hardcore-plan` per the contract, go to `/hardcore/[session]`; mobile layout, light/dark (FR-018)
- [x] T017 [US1] Create src/routes/hardcore/[session]/+page.svelte: load `hardcoreSession`, compute `nextStep`; for `drill` record the step start, build each word's `CardSentence` for its line (`source: 'reader'`, `documentId`, `lineText`, `lineFrom`, `line`, `from`/`to` the line range, `wordFrom`/`wordTo` of the first occurrence in it), skip `passedToday` words, show `CardFace`, record each grade at once as a `review` per the contract (session id, occurrence range, `hardcore: { part }`, `line`), step end when the queue empties; offers Next part / End; links for other steps added in US3
- [x] T018 [US1] Add browser scenario `hardcore` to scripts/verify-in-browser/harness.mjs and its README row: import the 45 s clip, document page → Hardcore → steps drill only → grade one Again then Good for all → session ends; assert the session's `review` encounters (Diagnostics or a worker query) equal the grades given and carry `hardcore` and `line`

## Phase 4: User Story 2 — Drill grades shape memory without flooding Cards (P1)

Goal: the rule of Phase 2 holds through storage: drilled lines discount later watching; Cards
unaffected; withdrawal and backups carry the records.
Independent test: quickstart Storage passes.

- [x] T019 [P] [US2] Write failing tests in tests/storage/rewatch.test.ts: a line drilled (hardcore review with `detail.line` over it) then played in a later media session answered `all` gives that word's exposure `rewatchDays` ≈ the hours between / 24, also for another word of the same line; the drill review is no exposure itself; a Cards review's sentence does not count
- [x] T020 [US2] In `wordHistory` (src/lib/storage/repository.ts near line 1462) add the hardcore reviews whose `detail.line` covers an occurrence of the word to `viewings` (keyed `document start`, session = the review's session, at = review time), never to exposures, until T019 passes; mutate once (drop the addition)
- [x] T021 [P] [US2] Add to tests/storage/hardcore.test.ts: `withdrawDocument` removes the drill's reviews from the word's history (memory recomputed without them); a backup and restore (as tests/backup does) round-trips the `hardcore` session, plan, steps and reviews; `studyOverview` counts the drill reviews toward the day and lists no hardcore session
- [x] T022 [US2] Make T021 pass if it does not already (expected: no change, R1); note the result in the task — passed with no change (2026-10-13)

## Phase 5: User Story 3 — Watch the fragment around the drill (P1)

Goal: watch first / watch after play exactly the part and come back; text parts read with Done;
English preview.
Independent test: browser `hardcore` with all four steps.

- [x] T023 [US3] In src/routes/read/[id]/+page.svelte read `until` (seconds), `back` (path) and `step` (`session.part.step`); pass `until` to src/lib/ui/MediaReader.svelte, which pauses at `until` with the per-frame check used by `stopAtLineEnd` and shows **Back to the session** (goto `back`, through the existing "Before you go" sheet) and **Again** (seek to `t`)
- [x] T024 [US3] For a text, read `from`/`to` (line indices) and `back` in src/routes/read/[id]/+page.svelte: render only those lines' tokens, with **Done** going to `back`; reading is recorded as now
- [x] T025 [US3] In src/lib/ui/recorder.ts accept an optional hardcore link and write one `hardcore-watch` `{ session, part, step }` with the session's first batch; a recorder case in tests/storage/recorder.test.ts first
- [x] T026 [US3] In src/routes/hardcore/[session]/+page.svelte add the watch steps (record step start; link to `/read/[doc]?t=<first cue start>&until=<last cue end>&back=/hardcore/[session]&step=…`, or `from`/`to` for a text; returning records the step end) and the preview step (the part's lines with English from `englishFor` for a video, the quick translator for a text; for a video a link to the player with English shown and `until`)
- [x] T027 [US3] Extend the `hardcore` browser scenario: all four steps; watch first stops within 0.5 s after the part's last cue end and Back returns to the session at the drill step; the player session holds a `hardcore-watch`; run also `media`, `resume`, `autostop`, `leavingvideo`, `documentpage`

## Phase 6: User Story 4 — Cut a long fragment into parts by load (P2)

Goal: parts of about N words, a part list with done-today marks, start at any part.
Independent test: tests/domain/hardcore.test.ts cut properties; part list in the browser.

- [x] T028 [P] [US4] Write failing fast-check properties (`size: 'max'`) for `cutByLoad(lines, words, n)` in tests/domain/hardcore.test.ts: parts are consecutive and tile the fragment's lines; each word is in exactly one part, the first whose lines contain it; every part but the last holds ≥ n/2 words; a part holds ≤ 1.5 n unless its last line alone added more than n; parts never empty of lines
- [x] T029 [US4] Implement `cutByLoad` per research R6 in src/lib/domain/hardcore.ts until T028 passes; mutate the cut-before rule once
- [x] T030 [US4] In the setup page add Cut by load with part size (default 20) and the part list (line range, times for videos, word count); in the session page show the part list with "done today" (all its words in `passedToday`) and let the reader start or switch to any part; record the plan's `cut`

## Phase 7: User Story 5 — Choose which of the fragment's words to drill (P2)

Goal: filters (occurrences, top-y, coverage) and order, word count shown before starting.
Independent test: tests/domain/hardcore.test.ts filter properties.

- [x] T031 [P] [US5] Write failing properties in tests/domain/hardcore.test.ts: each filter only removes words; a stricter value (higher x, lower y, lower z) never adds a word; with coverage z the kept words are a prefix of the drillable words by fragment frequency, and dropping the last kept word leaves coverage below z (unless none kept); coverage counts running words = word tokens of the fragment and known per `known`
- [x] T032 [US5] Implement the filters and order in `drillWords` (src/lib/domain/hardcore.ts) until T031 passes; mutate the coverage stop once
- [x] T033 [US5] Add the filter fields (empty = off) and the order choice to the setup page, updating the word count live; record them in the plan

## Phase 8: User Story 6 — Come back to a part later the same day (P3)

Goal: words passed today are skipped.
Independent test: pass 7 of 20, leave, start the part again: 13 cards.

- [x] T034 [US6] Extend the `hardcore` browser scenario: pass two words, leave, start a new session on the same fragment: those two are not drilled and the part is not yet marked done

## Phase 9: Polish and phone round

- [x] T035 Run `npm run check`, `npm run lint`, the full `npx vitest run`; ask the test-auditor agent to audit tests/domain/hardcore.test.ts and the new storage tests for expected-value assertions on derived data
- [x] T036 Measure on the laptop the setup page's planning time for the longest film fixture available (or a synthetic 650-line document); record it
- [x] T037 Update docs/current-state.md (what was built, tests, mutations, scenarios) and docs/backlog.md (#36 entry: built, phone check pending)
- [ ] T038 Deploy with `npm run build` and the usual deploy; on the phone: a cut-by-load session from Continue on a real film, 20-word parts, all steps; time planning, a 20-word drill (SC-4) and the stop at the part's end (SC-5); Cards shows none of the drilled new words due (SC-2); the "Before you go" sheet after each watch step; the one-time memory recompute finishes in the background; record results in docs/current-state.md and close #36 if all hold

## Dependencies

- Phase 2 before everything: the record shapes and the memory rule are settled before the first
  hardcore row is written.
- US1 (T010–T018) before US3–US6: they extend its two pages and its domain module.
- US2 (T019–T022) depends only on Phase 2; can run beside US1.
- US3, US4, US5 are independent of each other after US1 (US4 and US5 both edit
  src/lib/domain/hardcore.ts and the setup page: do them one after the other).
- US6 needs US1's skip (T017) and is a check, not new code.
- Phase 9 last.

## Parallel examples

- Phase 2: T003, T005, T008 (three test files) together; then T004, T006, T009.
- US1: T010 and T011 (one test file, write together), T013 and T014 in parallel with T012.
- US2 beside US1: T019 and T021 while US1's pages are built.

## Implementation strategy

MVP is Phase 2 + US1 (drill only, one part) with US2's storage guarantees: usable in the isolated
browser end to end. US3 adds watching, US4/US5 the long-film workflow, US6 is a check. Everything
ships together in one deploy (the reader's choice) after Phase 9's laptop checks.
