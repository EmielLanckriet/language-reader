# Tasks: Subtitle track choice at import

Input: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/bundle-and-service.md](contracts/bundle-and-service.md), [quickstart.md](quickstart.md).
Tests are limited to what the plan names: the shared choice rule, alignment properties, English
order, and one test per plumbing path (docs/working-rules.md: make each test fail once).

## Phase 1: Setup

- [X] T001 Write the shared case table tests/fixtures/track-choice-cases.json: each case lists tracks (`file`, `lang`, `name`, `kind`, cue text) and the expected default Chinese file, default English (`file` | `machine`), and `needed`; include Jun's clean+pinyin pair (not needed), two clean Chinese (needed), clean Chinese + human English (needed), identical `zh`/`zh-Hans` copies (not needed), only automatic Chinese, only a mixed track, pre-012 bundle without manifest
- [X] T002 [P] Add fixture bundles to scripts/verify-in-browser/make-fixtures.sh: `fixture-tracks-clean-mixed` (Jun's shape, `track.zh.vtt` clean + `track.zh-Hans.vtt` with pinyin lines, `tracks.json`) and `fixture-tracks-english` (clean Chinese + human `track.en.vtt` with shifted timings and one Chinese line left uncovered)

## Phase 2: Foundational (blocks all stories)

- [X] T003 [P] Write failing vitest cases driven by tests/fixtures/track-choice-cases.json in tests/media/track-choice.test.ts for `classifyTracks`, `defaultChoice` and `choiceNeeded`
- [X] T004 [P] Write failing Python cases driven by the same table in scripts/termux/test_translate.py for translate.py's `choice_needed` and default source
- [X] T005 Implement `classifyTracks` (chinese / english / mixed / duplicate fingerprint), `defaultChoice` and `choiceNeeded` in src/lib/media/subtitles.ts, reusing `mixedShare`; keep `chooseChineseTrack` as a thin wrapper so tests/media/subtitles.test.ts still passes
- [X] T006 Implement `choice_needed` and the default source in scripts/termux/translate.py, reusing `mixed()`; make T004 pass
- [X] T007 Read `tracks.json` and `track*.vtt` members in src/lib/media/import.ts (new `planImport(bundle)` returning tracks, defaults and `needed`); pre-012 bundles (no manifest, `media.<lang>.vtt`) map to the same shape with `kind: human` and `name: ''`
- [X] T008 Exclude `track*` names from `isSubtitle` and add `TRACKS = 'tracks.json'` and `ENGLISH_SETTING = 'english.json'` to src/lib/media/store.ts; `loadMedia` returns the manifest, track files and English setting

## Phase 3: User Story 1 — Read the clean Chinese track (P1)

Goal: new-format bundles import the clean Chinese track without asking when there is no real choice.
Independent test: import `fixture-tracks-clean-mixed`; the document text equals the clean track and no choice is shown.

- [X] T009 [US1] Make `importBundle(bundle, title, choice?)` in src/lib/media/import.ts use `planImport` defaults when no choice is passed; save the chosen Chinese track as `media.<lang>.vtt`, plus `tracks.json` and every `track*.vtt` (FR-008), plus `english.json` with the default English
- [X] T010 [US1] Two-pass subtitle download in scripts/termux/termux-url-opener per research R1 (human `all,-live_chat` with the video as `track.%(ext)s`; automatic Chinese only when no human Chinese arrived, as `track-auto.%(ext)s`); write `tracks.json` from the info JSON before trimming it to meta.json
- [X] T011 [US1] In scripts/termux/termux-url-opener start translate.py only when `choice_needed` is false (call translate.py's rule, e.g. `translate.py --needs-choice <job>` exit code); unchanged for pre-012 jobs
- [X] T012 [US1] Browser scenario `tracks-clean-mixed` in scripts/verify-in-browser/ using `fixture-tracks-clean-mixed`: no sheet, text equals the clean track; and the existing `media` scenario still passes for the pre-012 fixture (FR-009)

## Phase 4: User Story 2 — Choose the tracks myself when there is a choice (P1)

Goal: a bottom sheet with previews and preselected defaults appears only when `needed`; the choice reaches Termux.
Independent test: open `fixture-tracks-english`; the sheet shows both kinds of choice with defaults; confirm imports; leaving imports nothing and the job stays listed.

- [X] T013 [P] [US2] Create src/lib/ui/TrackChoice.svelte on the StateMenu bottom-sheet pattern (backdrop, `role="dialog"`, Escape closes): Chinese options (each track's name, human/automatic, first three lines, plus "Transcribe it myself"); English options (human tracks, "Machine translation", "None"); defaults preselected; one Confirm action; light/dark and keyboard accessible (FR-004, FR-010)
- [X] T014 [US2] In src/routes/+page.svelte `openJob`: fetch the bundle, `planImport`, show TrackChoice when `needed`, then `importBundle(bundle, title, choice)`; "Transcribe it myself" takes the existing pending path; closing the sheet imports nothing and leaves the job listed
- [X] T015 [US2] Add `reportChoice(job, choice)` to src/lib/media/termux.ts (`PUT /downloads/<job>/choice.json`), called after an asked choice is imported; a failure is shown but does not undo the import
- [X] T016 [P] [US2] Write failing tests in scripts/termux/test_service.py for `PUT /downloads/<job>/choice.json`: 204 and translate.py started (TRANSLATE_STUB=1); not started for `english: none` or `chinese: transcribe`; 400 for a file not in tracks.json; 404 for an unknown job
- [X] T017 [US2] Implement the endpoint in scripts/termux/reader-service.py per contracts/bundle-and-service.md; translate.py reads its source from `choice.json` when present
- [X] T018 [US2] Browser scenario `tracks-choice` in scripts/verify-in-browser/: sheet appears with defaults; confirm imports; a second run that closes the sheet leaves the job in "New from Termux"

## Phase 5: User Story 3 — Read a human English translation (P2)

Goal: the chosen English track is aligned by time and shown first; machine translation covers only the gaps.
Independent test: with `fixture-tracks-english` imported using the human track, every covered line shows human English marked as such, and the uncovered line falls back to quick/LLM English.

- [X] T019 [P] [US3] Write failing property tests in tests/translation/lines.test.ts for `humanByLine` (every English cue appears once, order kept, identical timings map one-to-one) and for `englishFor` never replacing a human line
- [X] T020 [US3] Implement `humanByLine` (research R3) and the `human` input and `'human'` source of `englishFor` in src/lib/translation/lines.ts
- [X] T021 [US3] Read `english.json` and the chosen track in src/routes/read/[id]/+page.svelte and src/routes/live/[job]/+page.svelte; show human lines with their source; skip following Termux when the source is `none`
- [X] T022 [US3] translate.py translates only the lines `humanByLine`'s Python equivalent leaves uncovered when `choice.json` names an English track; `translate.json.total` counts those lines; add one test in scripts/termux/test_translate.py
- [X] T023 [US3] Extend the `tracks-choice` browser scenario: human lines visible with their source, and the uncovered line shows machine English

## Phase 6: User Story 4 — Change the English later (P3)

Goal: switch between the human track, machine translation and none on a media document without touching earned data.
Independent test: switch English on an imported document; marks, encounters and lookups are unchanged.

- [X] T024 [US4] Add an English source switch to the read page menu in src/routes/read/[id]/+page.svelte; it rewrites only `english.json` and, when switching to machine for lines a human track covered, calls `reportChoice` with `english: machine`
- [X] T025 [US4] Browser scenario step: mark a word, switch English twice, assert the mark and encounter counts are unchanged (SC-4)

## Phase 7: Polish & cross-cutting

- [X] T026 [P] Write docs/adr/0036-subtitle-tracks-chosen-at-import.md (track naming, choice protocol, app-before-Termux deployment order)
- [X] T027 [P] Update specs/008-in-app-speech-to-text/contracts/reader-service.md with a pointer to the 012 contract. Backup unchanged by decision (ADR-0036: derived English setting, versioned format); recorded as an accepted limitation instead
- [X] T028 Run vitest, Python unittest, type check, lint and the affected `verify:browser` scenarios (quickstart.md laptop checks 1–4)
- [ ] T029 Deploy the app, then the Termux scripts (setup/update), then run quickstart.md phone checks 1–3 in one batch; record the video with a human English track used for check 2 in quickstart.md
- [ ] T030 Update docs/current-state.md with the result, including what was and was not verified on the phone

## Dependencies

- T001 → T003, T004. T003 → T005; T004 → T006. T005 → T007 → T008 → all stories.
- US1 (T009–T012) first; US2 needs T009 (`importBundle` with a choice) and T006 (`choice_needed`).
- US3 needs US2's `english.json` and `choice.json` (T009, T017). US4 needs US3 (T021).
- Polish after the stories; T029 needs T028; T030 last.

## Parallel opportunities

- Setup: T002 alongside T001.
- Foundational: T003 and T004 (different languages, same table).
- US2: T013 (the sheet) and T016 (service tests) alongside T014/T015.
- US3: T019 alongside T021's UI work once T020's signature is fixed.
- Polish: T026 and T027.

## Implementation strategy

MVP is US1 + US2 together (the choice is only useful once more tracks are downloaded), shipped with
T010/T011 so Termux and the app agree. US3 follows in the same deploy if ready; the phone check
(T029) is batched once for all stories (docs/working-rules.md). US4 is small and may ship with US3.
