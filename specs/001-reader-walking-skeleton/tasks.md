# Tasks: Reader Walking Skeleton (Slice 0)

**Input**: Design documents from `/specs/001-reader-walking-skeleton/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included and **mandatory**. Constitution Principle II requires test-first for word state
transitions, history replay, and segmentation invariants. Those tests are written before their
implementations and are expected to fail when written — that failure is the point, not a defect.

**Organization**: Grouped by user story so each is independently implementable and testable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on incomplete work
- **[Story]**: Which user story the task serves

## Path Conventions

Single SvelteKit application at the repository root: `src/lib/`, `src/routes/`, `tests/`. There is
no backend directory, because there is no server (ADR-0007).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project skeleton and toolchain. Nothing here is observable to a reader.

- [X] T001 Initialise a SvelteKit + TypeScript project at the repository root, keeping existing `docs/`, `specs/` and `.specify/` untouched
- [X] T002 Install and configure `@sveltejs/adapter-static` in `svelte.config.js`, setting `paths.base` for a GitHub Pages subpath
- [X] T003 [P] Configure `vitest` and `fast-check` in `vite.config.ts` and `package.json`
- [X] T004 [P] Configure ESLint and Prettier in `eslint.config.js` and `.prettierrc`
- [X] T005 [P] Install `@sqlite.org/sqlite-wasm` and add the required COOP/COEP-free OPFS setup notes to `README.md`
- [X] T006 Create the empty directory skeleton `src/lib/{domain,analyzer,content,storage,diagnostics,ui}/` and `tests/{domain,architecture,storage}/` per plan.md

**Checkpoint**: `npm run dev -- --host 0.0.0.0` serves a blank app reachable from the phone over wifi.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The domain vocabulary, the schema, and the boundary rule. Everything else depends on
these.

**⚠️ CRITICAL**: No user story work begins until this phase completes.

### Tests first (Principle II)

- [X] T007 [P] Write failing tests for code-point offsets in `tests/domain/offsets.test.ts`, including Extension-B hanzi and emoji, asserting round-trip fidelity and that no offset is a UTF-16 code unit
- [X] T008 [P] Write failing test in `tests/architecture/domain-purity.test.ts` asserting no file under `src/lib/domain/` imports Svelte, SvelteKit, or `src/lib/storage/`
- [X] T009 [P] Write failing test in `tests/storage/migration.test.ts` asserting the schema contains `provenance`, `user_id`, `device_id`, `device_seq`, `document_id`, `from_offset`, `to_offset` and `observed_pronunciation`, and that the always-present hedges — `provenance`, `user_id`, `device_id`, `device_seq` — are `NOT NULL` or carry an explicit default. The occurrence hedges stay nullable by design: slice 0 often has no occurrence to record, and a column that is *sometimes* empty for a stated reason is different from one that is *always* empty because nothing writes it

### Implementation

- [X] T010 Implement `src/lib/domain/offsets.ts` as the sole place strings are measured or sliced by position, in Unicode code points
- [X] T011 Define domain types in `src/lib/domain/types.ts` — `Lexeme`, `Token`, `WordState`, `HistoryEntry`, `Occurrence` — per data-model.md
- [X] T012 Write `src/lib/storage/migrations/001-initial.sql` creating `lexeme`, `document`, `token`, `word_state`, `status_event`, `device` and `diagnostic` per data-model.md, with every hedge column present and declared `NOT NULL` or defaulted — `provenance` `NOT NULL` without a default, so an insert that omits it fails rather than storing an empty hedge
- [X] T013 Implement `src/lib/storage/db.ts`: open SQLite-WASM against OPFS, apply numbered migrations in order, record applied versions
- [X] T014 Implement device identity and the monotonic counter in `src/lib/storage/db.ts` — generate `device.id` once on first run, allocate `device_seq` on demand

**Checkpoint**: T007, T008 and T009 pass. The database opens, migrates, and survives a page reload.

---

## Phase 3: User Story 1 — Save and read a text (Priority: P1)

**Goal**: Paste Chinese text, store it, see it back as discrete tokens on a phone screen.

**Independent test**: Paste a passage, save, navigate away, return. Text intact, tokens in order,
nothing added or dropped. Delivers a plain reading surface even with no marking.

### Tests first

- [X] T015 [P] [US1] Write failing property test in `tests/domain/tiling.test.ts` asserting tokens are ordered, non-overlapping, gapless and reassemble to the input exactly — over generated inputs mixing hanzi, Latin text, punctuation, newlines and astral-plane characters. **Never assert an expected segmentation.**

### Implementation

- [X] T016 [US1] Implement `src/lib/domain/tiling.ts` — the tiling invariants of FR-005 as a checkable function over a token list and its source content, so the rule lives in one place rather than only inside T015's assertions
- [X] T017 [P] [US1] Define the `Analyzer` interface in `src/lib/analyzer/types.ts` per contracts/analyzer.md — `analyze` returns a `Promise`, deliberately, so a later async and fallible analyzer fits
- [X] T018 [P] [US1] Define the `ContentSource` interface in `src/lib/content/types.ts` per contracts/content-source.md
- [X] T019 [US1] Implement the placeholder analyzer in `src/lib/analyzer/character.ts` — one token per code point, `name: "character-splitter"`, `version: "1"`, `isWord` true for CJK ranges. **Do not improve it.**
- [X] T020 [US1] Implement `src/lib/content/paste.ts` — validate non-empty and at most 5,000 Unicode code points, measured through `src/lib/domain/offsets.ts`; emit `text/plain` with a title from the opening characters (FR-018, FR-020)
- [X] T021 [US1] Implement `saveDocument`, `listDocuments` and `getDocument` in `src/lib/storage/repository.ts`; `saveDocument` rejects analyzer output failing `src/lib/domain/tiling.ts`, and `getDocument` returns retained raw content **and** tokens, per contracts/repository.md
- [X] T022 [US1] Build the library screen in `src/routes/+page.svelte` — list saved documents, paste-and-save form, rejection messages
- [X] T023 [US1] Build the reader screen in `src/routes/read/[id]/+page.svelte` — render tokens as discrete elements, mobile-first, no horizontal scroll (FR-017)

**Checkpoint**: US1 is independently usable. Paste, save, reopen, read. Nothing is markable yet.

---

## Phase 4: User Story 2 — Mark what I know (Priority: P2)

**Goal**: Tap a token, choose a state from a menu, see it distinguished, and find it unchanged
later — including in other documents containing the same word.

**Independent test**: Mark several tokens with different states, reload, confirm marks and
appearance survived. Open a second document containing a marked word; it already shows that state.

### Tests first

- [X] T024 [P] [US2] Write failing tests in `tests/domain/state.test.ts` for the state set and the projection — that current state is a function of history alone, using `fast-check`'s model-based testing over generated assertion sequences
- [X] T025 [P] [US2] Write failing test in `tests/domain/history.test.ts` asserting that folding entries in `(device_id, device_seq)` order reproduces `word_state` exactly for every lexeme (FR-011)
- [X] T026 [P] [US2] Write failing test in `tests/storage/provenance.test.ts` asserting that after one `assertState` call, the resulting `word_state` row **and** its `status_event` row both carry a non-null `provenance` and `user_id` (FR-012, FR-013)
- [X] T027 [P] [US2] Write failing test in `tests/storage/counts.test.ts` asserting that 100 assertions across distinct words yield exactly 100 `word_state` rows and exactly 100 `status_event` rows, and that re-asserting the same word adds a history entry without adding a state row (SC-004, FR-006b)

### Implementation

- [X] T028 [P] [US2] Implement `src/lib/domain/state.ts` — the extensible state set as data, and slice 0's trivial projection (latest assertion wins) per FR-006a and FR-010b
- [X] T029 [US2] Implement `src/lib/domain/history.ts` — append-only entry construction recording *what was asserted*, never what the state became (FR-010a)
- [X] T030 [US2] Implement `assertState` in `src/lib/storage/repository.ts` — append `status_event` first, allocating `device_seq` and writing `provenance` (`manual` in slice 0, per data-model.md) and `user_id`, then update `word_state` carrying the same two values; never the reverse (FR-012, FR-013)
- [X] T031 [US2] Implement `getStates`, `readHistory` and `rebuildProjection` in `src/lib/storage/repository.ts` per contracts/repository.md; `rebuildProjection` must be exercised by T025, not merely written
- [X] T032 [US2] Implement find-or-create of lexemes in `src/lib/storage/repository.ts`, applying the language provider's identity rule rather than the repository's own (FR-009). **Landed early, in T021**: `token`'s `CHECK ((is_word = 1) = (lexeme_id IS NOT NULL))` means a document cannot be saved without resolving its word tokens to lexemes, so this is a prerequisite of US1 rather than of US2. The rule is exposed as `Analyzer.lexemeKey`, which the contract's obligation 5 requires but its interface sketch omits
- [X] T033 [US2] Build the state menu in `src/lib/ui/StateMenu.svelte` — opens on tap, lists available states from configuration, every target at least 44x44 CSS pixels (FR-017)
- [X] T034 [US2] Wire tapping and visual state distinction into `src/routes/read/[id]/+page.svelte`; untouched words must be visually distinct from any chosen state (FR-006b)

**Checkpoint**: US1 and US2 both work. The full paste–read–mark loop is complete locally.

---

## Phase 5: User Story 3 — Use it on my phone (Priority: P3)

**Goal**: The deployed application, on the phone, with data on the device — and failures you can
read without a second device.

**Independent test**: Open the deployed app on the phone with the development machine closed, and
complete Stories 1 and 2.

- [X] T035 [P] [US3] Implement the on-device diagnostics record in `src/lib/diagnostics/log.ts`, writing to the `diagnostic` table (FR-021)
- [X] T036 [US3] Surface failures in the interface via `src/lib/ui/ErrorNotice.svelte`, distinguishing a refused input, a storage failure and an unexpected error (FR-022)
- [X] T037 [P] [US3] Request persistent storage with `navigator.storage.persist()` at first write in `src/lib/storage/db.ts`, recording the outcome to diagnostics
- [X] T038 [US3] Verify the production build locally with `npm run build && npm run preview`, confirming `paths.base` resolves assets correctly
- [X] T039 [US3] Add the GitHub Pages deployment workflow in `.github/workflows/deploy.yml` and enable Pages on the repository
- [ ] T040 [US3] Deploy, then complete a full paste–read–mark cycle **on the phone, away from the development machine** — steps 1–5 of `specs/001-reader-walking-skeleton/quickstart.md` § Validation (SC-008). **This slice is not complete until this passes.**

**Checkpoint**: Principle I satisfied. The slice is shippable.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T041 [P] **Verified on desktop Chrome during implementation** — 你𠀋好吗 tiled as four tokens and marking the third marked 好, not 吗. The phone run is now confirmation rather than discovery. Verify astral-plane handling by hand per `specs/001-reader-walking-skeleton/quickstart.md` § Two checks that are easy to skip — paste a passage with an Extension-B hanzi, mark tokens either side, reload, confirm marks land on the right tokens. Fails silently if any offset is counted in UTF-16 units
- [X] T042 [P] Call `rebuildProjection()` against a database holding real marks and confirm nothing changes — the executable proof that `word_state` is a cache
- [ ] T043 [P] Induce each failure from quickstart.md step 4 on the phone and confirm each is identifiable from the interface alone (SC-009)
- [ ] T044 [P] Measure SC-001, SC-002 and SC-003 on the phone and record the figures in `specs/001-reader-walking-skeleton/quickstart.md` — opening the app to markable tokens under 30 s, a 2,000-character document rendering within 2 s, a state change showing within 200 ms
- [X] T045 Write `README.md` covering setup, the phone development loop with `--host`, tests, and deployment
- [X] T046 Record in `docs/anticipated-changes.md` anything slice 0 revealed that should change slice 1's plan

---

## Dependencies

**Phase order**: Setup → Foundational → US1 → US2 → US3 → Polish.

**Story dependencies**:

- **US1** depends on Phase 2 only.
- **US2** depends on Phase 2 and on US1 — it needs tokens on screen to tap. This is a genuine
  dependency, not sequencing by convenience.
- **US3** depends on US1 and US2 having something worth deploying.

**Within Phase 2**: T007–T009 are parallel. T010 blocks T011. T012 blocks T013, which blocks T014.

**Within US1**: T015, T017 and T018 are parallel. T016 implements what T015 asserts, so it follows
T015. T019 needs T017; T020 needs T018; T021 needs T016, T019 and T020; T022 and T023 need T021.

**Within US2**: T024–T027 are the four test-first tasks and are parallel. T028 blocks T029, which
blocks T030–T032. T026 and T027 pass only once T030 does. T033 and T034 follow.

## Parallel Execution Examples

**Phase 2 tests** — three independent files, all failing on purpose:

```
T007 tests/domain/offsets.test.ts
T008 tests/architecture/domain-purity.test.ts
T009 tests/storage/migration.test.ts
```

**US1 interfaces** — two contracts, two files:

```
T017 src/lib/analyzer/types.ts
T018 src/lib/content/types.ts
```

**US2 tests** — four independent files, all failing on purpose:

```
T024 tests/domain/state.test.ts
T025 tests/domain/history.test.ts
T026 tests/storage/provenance.test.ts
T027 tests/storage/counts.test.ts
```

**Phase 6** — T041 through T044 are independent checks.

## Implementation Strategy

**MVP scope**: Phases 1–3 (through US1). That is a real deliverable — paste and read Chinese text
on your phone — and it validates the storage engine, the two seams, and the deployment path, which
is what slice 0 exists to prove.

**Incremental delivery**: US2 makes it useful; US3 makes it true, per Principle I. Deploy after
US3 rather than after each story, but check on the phone continuously using
`npm run dev -- --host 0.0.0.0`, which costs seconds rather than a deploy.

**The riskiest task is T013.** SQLite-WASM against OPFS is the least familiar thing here and the
most likely to consume a day (ADR-0008 says so explicitly). If it stalls, slice 0's data is
disposable and the domain boundary is enforced by test — so falling back to IndexedDB costs
`src/lib/storage/` and nothing above it. Take that option rather than losing the slice to it.

**Do not improve the placeholder analyzer (T019).** A better character splitter makes the slice
look more finished while validating nothing extra. The spec defines that as a defect.
