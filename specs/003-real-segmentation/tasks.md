---

description: "Task list for slice 2: real segmentation, measured"
---

# Tasks: Real Segmentation, Measured (Slice 2)

**Input**: Design documents from `/specs/003-real-segmentation/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/)

**Tests**: Test tasks are **required**, not optional. Segmentation correctness is on Constitution
Principle II's mandatory test-first list, and the tests are written before the implementation they
cover. They are asserted **on properties only** — never against expected segmentations, because
word-hood is analyzer-dependent (ADR-0002) and an expected-value test encodes one ICU build's opinion
and breaks on the next. The single exception is earned data, which is asserted exactly.

**Organization**: grouped by user story. Unlike slice 1, these stories are **not** independent:
US1 and US2 both need the analyzer that Phase 2 builds, and US3 measures what US1 ships.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on incomplete work)
- **[Story]**: US1, US2, US3 — user story phases only

## Path Conventions

Single project. `src/lib/` for application code, `tests/` flat by area matching the existing layout,
`scripts/` for laptop-side tooling that is never bundled.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: make the install-size budget a build gate before anything can breach it.

- [X] T001 Build slice 1 exactly as it ships (`BASE_PATH=/language-reader npm run build`) and record the install baseline — file count and total bytes, currently 34 files and 1.40 MB — as a documented constant in `scripts/check-bundle.mjs`
- [X] T002 Extend `scripts/check-bundle.mjs` to fail the build when the total build size exceeds that baseline by more than the agreed margin, with a message naming the largest added file (FR-033, FR-034, SC-008)

**Checkpoint**: a candidate's dictionary cannot enter the bundle without failing the build. This is
the same mechanism slice 1 used for duplicate SQLite, and it exists because the precache list is
generated from the build output, so an accidental data file is downloaded by every install.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the analyzer itself. Every user story depends on this phase.

**⚠️ CRITICAL**: no user story work begins until this phase is complete.

Ordered so the defect that could corrupt **earned** data is found first. R2 is invisible in any text
made only of BMP characters, so it would ship undetected and retroactively mis-anchor recorded
judgments.

### Tests first (Principle II)

- [X] T003 [P] Extend `tests/domain/offsets.test.ts` with properties for a UTF-16-index-to-code-point-index conversion: it agrees with `codePointsOf` on all-BMP text, and diverges correctly on astral input — `𠮷野家很好` is five code points in six UTF-16 units, where the platform reports token indices 0, 2, 4 (research.md R2)
- [X] T004 [P] Create `tests/analyzer/contract.test.ts` asserting the analyzer contract's obligations against **any** implementation, driven by a table of analyzers so `character.ts` and `chinese.ts` are both held to it: whole-document tiling via the existing `checkTiling` from `src/lib/domain/tiling.ts`, offsets valid as code-point indices, every code point covered exactly once, `isWord` false for punctuation and whitespace, determinism across repeated calls, idempotence
- [X] T005 [P] Create `tests/analyzer/units.test.ts` asserting that segmentation units reassemble into the source exactly with delimiters retained, and that no token spans a unit boundary (FR-002, FR-005)
- [X] T006 [P] Create `tests/analyzer/fingerprint.test.ts` asserting the fingerprint is stable across repeated calls and freshly constructed segmenters, changes when the probe output changes, and is recorded on documents as `analyzer_version`

### Implementation

- [X] T007 Add the UTF-16-index-to-code-point-index conversion to `src/lib/domain/offsets.ts` as a named, tested helper — not an inline expression at the call site (Principle VII; this is the line most likely to be written cleverly and wrongly)
- [X] T008 [P] Create `src/lib/analyzer/fingerprint.ts`: the committed probe string, and derivation of a short hash from the `(offset, text)` sequence a segmenter produces over it (ADR-0011)
- [X] T009 [P] Create `src/lib/analyzer/units.ts`: split text into segmentation units using a delimiter set supplied by the caller, retaining delimiters (ADR-0013)
- [X] T010 Add `unitDelimiters` to the `Analyzer` interface in `src/lib/analyzer/types.ts`, with the admission rule stated in the doc comment: a character qualifies only if it cannot occur inside a word in that language, and doubt resolves toward excluding it (contracts/analyzer.md obligation 9)
- [X] T011 Declare `unitDelimiters` on `src/lib/analyzer/character.ts` so the placeholder still satisfies the revised contract, and leave its behaviour otherwise untouched — it must remain deliberately weak
- [X] T012 Create `src/lib/analyzer/chinese.ts`: `Intl.Segmenter('zh', {granularity:'word'})` behind seam 1, with `name: "intl-segmenter-zh"`, `version` from the fingerprint, `unitDelimiters` of line breaks and CJK sentence punctuation **excluding the ASCII full stop**, offsets converted via T007, and `isWord` decided by Han script and **not** by the platform's `isWordLike` (contracts/analyzer.md obligation 10, research.md R7)
- [X] T013 Create `src/lib/analyzer/active.ts` naming the one active analyzer, and change `src/routes/+page.svelte` to import from it rather than importing `characterSplitter` directly — two callers now have to agree on which analyzer is active, and a disagreement would stamp documents wrongly

**Checkpoint**: both analyzers pass the same property suite, and `chinese.ts` produces real words in a
unit test. The riskiest work in the slice is done and proven.

---

## Phase 3: User Story 1 - The words I mark are words (Priority: P1) 🎯 MVP

**Goal**: reading the application produces vocabulary rather than characters.

**Independent test**: paste a passage containing multi-character words, confirm each renders as one
markable span, mark one, and confirm the word list shows the whole word.

- [X] T014 [US1] Segment newly imported documents with the active analyzer in `src/routes/+page.svelte`, stamping `analyzer` and `analyzer_version` from it (FR-010)
- [X] T015 [P] [US1] Make word boundaries visually distinguishable in `src/routes/read/[id]/+page.svelte` — a wrong split the reader cannot see is a wrong mark they cannot avoid (FR-012)
- [X] T016 [P] [US1] Show the analyzer name and its fingerprint in the reader's subtitle in `src/routes/read/[id]/+page.svelte`, replacing the slice-0 `v1` display; the fingerprint is opaque by design (ADR-0011) and is what the phone check compares against
- [X] T017 [US1] Add an integration test in `tests/storage/document.test.ts` covering import under the real analyzer: a multi-character word becomes one token bound to one lexeme, and marking it records one judgment against that lexeme rather than against its characters

**Checkpoint**: 我在中国学习中文 shows 中国, 学习 and 中文 as single markable spans. Expect 自行车 to come
back as 自行 + 车 — a recorded, measured weakness (research.md R1), not a defect to fix in this slice.

---

## Phase 4: User Story 2 - My existing documents catch up (Priority: P2)

**Goal**: documents saved under the placeholder show real words without being re-imported, and every
mark survives.

**Independent test**: with a document created under `character-splitter v1` in hand, open it after the
change — real words appear, it was never re-imported, and the set of recorded marks is unchanged.

**Why this matters beyond the story**: this is where slice 0's claim that swapping an analyzer is a
recompute rather than a migration is executed for the first time.

### Tests first (Principle II — earned data)

- [X] T018 [P] [US2] Add a test in `tests/storage/provenance.test.ts` asserting that re-deriving a document leaves `status_event` and `word_state` rows **exactly** identical in count and content — earned data is asserted exactly, never as a property (FR-023, FR-024)
- [X] T019 [P] [US2] Add a test in `tests/storage/document.test.ts` asserting `document.raw_content` is byte-identical after re-derivation (FR-014)
- [X] T020 [P] [US2] Create `tests/storage/rederive.test.ts` asserting no document is ever observable with one analyzer's tokens under another analyzer's stamp, including when the operation throws part-way (FR-020, FR-021)

### Implementation

- [X] T021 [US2] Create `src/lib/storage/rederive.ts` with a single `rederiveDocument(documentId, analyzer)`: read `raw_content`, analyze, delete and rewrite `token` rows, add any new `lexeme` rows, update the stamp — all in one transaction, idempotent, deleting no lexemes (contracts/re-derivation.md)
- [X] T022 [US2] Path A — re-derive on open in `src/routes/read/[id]/+page.svelte` before the document renders, so placeholder tokens are never shown in a document the reader opened (FR-015)
- [X] T023 [US2] Tell the reader what is happening if Path A is slow enough to notice, in `src/routes/read/[id]/+page.svelte` (FR-022)
- [X] T024 [US2] Path B — create `src/lib/storage/sweep.ts`: find stale documents by comparing their stamp to the active analyzer's, re-derive one at a time using the **same** `rederiveDocument`, releasing between documents (FR-016, FR-017)
- [X] T025 [US2] Make the sweep yield to the reader in `src/lib/storage/sweep.ts` — it must not delay opening a document, marking a word, or importing text (FR-018)
- [X] T026 [US2] Gate the sweep on the storage lease from slice 1 in `src/lib/storage/sweep.ts`: a copy that does not hold storage must not sweep, and the sweep must not itself become a source of lease contention (FR-019)
- [X] T027 [US2] Leave a failed document stale and move on rather than retrying hard, in `src/lib/storage/sweep.ts` — it will be retried on the next open or the next sweep
- [X] T028 [US2] Start the sweep when the application is idle, from `src/routes/+layout.svelte`
- [X] T029 [P] [US2] Report sweep progress and failures on `src/routes/diagnostics/+page.svelte` — quiet for the reader, discoverable where slice 1 put invisible work (FR-022)
- [X] T030 [US2] Add a test in `tests/storage/rederive.test.ts` asserting a mark on a form that no longer appears as a standalone word is still recorded under the same word identity after re-derivation (FR-025) — the reader marked 中 under the placeholder and it now lives only inside 中国. A **storage** assertion, not a UI change: no screen displays vocabulary yet, and building one is out of scope here
- [X] T031 [US2] Add a test in `tests/storage/rederive.test.ts` asserting both paths produce identical tokens for the same document (FR-017); with one shared implementation this should be near-trivial to satisfy, and it is the check that keeps it that way

**Checkpoint**: an existing library becomes uniform on its own, every mark intact, and killing the tab
mid-sweep leaves no document in a mixed state.

---

## Phase 5: User Story 3 - I can tell which segmenter is right for what I read (Priority: P3)

**Goal**: the analyzer choice rests on evidence from the reader's own material.

**Independent test**: run the comparison over a set of passages and obtain a report giving, per
candidate pair, how much they disagree and exactly where.

**Where this lives**: `scripts/compare-segmenters/`, laptop-side, never bundled
([ADR-0012](../../docs/adr/0012-candidate-comparison-runs-laptop-side.md)). The candidates
deliberately do **not** implement the `Analyzer` interface — they are not shipping, and an interface
built for implementations that do not exist is the speculative generality Principle V forbids.

**Delegation**: T032–T036 are the one cleanly separable chunk in this slice — no application code, a
crisp output contract, verifiable by running it. They are assigned to the `segmenter-comparison`
agent (Sonnet, `.claude/agents/segmenter-comparison.md`), whose boundary is the same one ADR-0012
drew. T037–T039 stay with the main session and with the reader: they need your material, your hand
annotation, and a judgment weighing quality against install cost.

- [X] T032 [P] [US3] Create `scripts/compare-segmenters/run.mjs` taking passages from a directory and emitting a report; Node built-ins only, and nothing under `src/`
- [X] T033 [P] [US3] Implement the candidates in `scripts/compare-segmenters/candidates/`: `Intl.Segmenter`, CC-CEDICT longest match, and a frequency-scored maximum-probability path, each fetching its own data at run time into a gitignored directory so no dictionary is ever committed or bundled
- [X] T034 [US3] Report per-pair disagreement as a proportion of character positions, not as anecdotes, in `scripts/compare-segmenters/report.mjs` (FR-026, FR-027)
- [X] T035 [US3] Show each disagreeing span with every candidate's reading of it in `scripts/compare-segmenters/report.mjs`, so a disagreement can be judged rather than counted (FR-027)
- [X] T036 [US3] Report short spoken-language lines separately from long prose in `scripts/compare-segmenters/report.mjs` (FR-028) — a segmenter can be good at one and bad at the other, and short lines are the intended content
- [X] T037 [US3] Collect at least five passages of the reader's own material into `scripts/compare-segmenters/passages/`, at least two of them subtitle- or transcript-like (SC-007). Not a benchmark corpus — the question is what *this* reader reads
- [X] T038 [US3] Hand-mark the words in one 500-character passage from `scripts/compare-segmenters/passages/` and record the proportion the shipped analyzer produced as single tokens into `specs/003-real-segmentation/research.md`, as the baseline later changes are compared against (SC-001)
- [X] T039 [US3] Write the conclusion into `specs/003-real-segmentation/research.md`: whether the shipped analyzer is materially worse than the alternatives held in reserve, on what evidence, and — if a better-scoring candidate was not adopted — why not, naming its install cost (FR-029, FR-030, SC-002)

**Checkpoint**: the question the register has carried since before slice 0 is answered in writing. An
absent conclusion means the slice is not finished (FR-029).

---

## Phase 6: Cross-Cutting Requirements

- [X] T040 Confirm install size is materially unchanged from slice 1 by building and reading the check in `scripts/check-bundle.mjs` from T002 — shipping `Intl.Segmenter` adds zero bytes, so any increase means something pulled a candidate's data into the bundle (FR-034, SC-008)
- [X] T041 [P] Confirm slice 1's guarantees still hold by working through the checks in `specs/003-real-segmentation/quickstart.md`: the application still installs, reads offline, and refuses changes it cannot keep (FR-035). This slice adds a capability; it removes no guarantee
- [X] T042 [P] Run the full suite, then hand the audit of `tests/analyzer/` and `tests/storage/` to the `test-auditor` agent (Sonnet, read-only, `.claude/agents/test-auditor.md`) to confirm no test in this slice asserts an expected segmentation — delegated deliberately, because the author of a test is the worst reviewer of whether it asserts the right thing. A test claiming 中国 is one token is a defect against Principle II and must be deleted, however reassuring it looks

---

## Phase 7: Deploy And Phone Check (Principle I)

**Purpose**: the gate. Nothing above counts until the phone says so (SC-009).

- [X] T043 Deploy the built application to its host
- [X] T044 On the phone: install from the home screen, enable aeroplane mode, **restart the device**, then open a saved document and read it with real words (SC-005). Run this first — it is the constitutional requirement and the slowest thing to discover late
- [X] T045 On the phone: mark a multi-character word in a single action (SC-006)
- [!] T046 **FAILED on the phone, 2026-09-03.** A 4,999-character document takes over 30 seconds and, in the reader's words, "doesn't even really work" — against SC-004's 3 seconds. Measured cause (research.md R18): the model costs ~4 s per 1,000 characters, some 1,050× the fallback dictionary, and the cost is linear in characters so batching cannot recover it. Threads are unavailable because GitHub Pages cannot send the COOP/COEP headers `SharedArrayBuffer` requires. Four options are priced in R18; none is chosen, because each changes either the data model or what the reader sees. **Slice 2 does not meet SC-004.**
- [X] T047 On the phone: **record the analyzer fingerprint the device reports** and compare it with the laptop's. This is the one fact no laptop measurement can supply. A difference is not a failure — ADR-0011 exists so that a difference re-derives rather than corrupts — but it must be written down
- [X] T048 On the phone: confirm a document created before this slice shows real words without being re-imported, and that the marks made on it are still present (SC-003)
- [X] T049 Record what the phone check revealed in `docs/anticipated-changes.md`, whether or not it revealed anything — including the device fingerprint from T047, and whether `Intl.Segmenter` on Chrome for Android agrees with the laptop's ICU. That agreement is the one part of this slice resting on an assumption rather than a measurement

**Checkpoint**: SC-009 satisfied. The slice is complete.

---

## Phase 8: What The Phone Check Asked For

**Purpose**: the phone found something no laptop measurement could, and it invalidated the slice's
central choice rather than adding a detail. Recorded as tasks rather than folded in silently.

- [X] T050 Report what this device does with its own text engine on `src/routes/diagnostics/+page.svelte`, so a difference between devices is a reading rather than a mystery
- [X] T051 [P] Carry a sample text on `src/routes/+page.svelte`, so checking the reader on a phone does not begin with typing Chinese on a touch keyboard
- [X] T052 Offer an update only when the waiting build differs from the running one, in `src/lib/ui/UpdateOffer.svelte` and `src/service-worker.ts` — a worker in `waiting` is not proof of a new version, and a notice that has once been meaningless is ignored when it matters (slice 1's FR-010)
- [X] T053 Establish, rather than infer, that the platform segmenter fails on the device: reproduce the fingerprint calculation outside the application, validate it against the known laptop value, and show that the phone's value is exactly the hash of character-per-character output (research.md R11)
- [X] T054 Generate the reader's own word list from CC-CEDICT headwords in `scripts/build-wordlist.mjs`, with the licence carried in the file and a content hash written to `src/lib/analyzer/wordlist-version.ts`
- [X] T055 Add the dictionary analyzer in `src/lib/analyzer/dictionary.ts`, sharing the unit delimiters now extracted to `src/lib/analyzer/delimiters.ts`
- [X] T056 Load the word list in `src/lib/analyzer/wordlist.ts`, precached for offline, refusing loudly rather than falling back to something that looks like segmentation and is not
- [X] T057 Point `src/lib/analyzer/active.ts` at the dictionary analyzer, keeping `chinese.ts` as what the comparison measures against
- [X] T058 [P] Hold the dictionary analyzer to the same contract as every other analyzer in `tests/analyzer/contract.test.ts`, and add its own properties in `tests/analyzer/dictionary.test.ts` — that any listed word standing alone comes back whole, and that no multi-character word it emits is absent from the list
- [X] T059 Move the install budget to the sanctioned figure in `scripts/check-bundle.mjs` with the written justification FR-034 requires, and record the decision in ADR-0014
- [X] T060 Verify in a browser over HTTP that words are words, the shell is installable, and reading works with the server stopped — serving the build under its base path rather than through `vite preview`, which mounts assets at the root and hides the difference behind a warm cache

**Checkpoint**: the reader splits Chinese into words on the device it is read on, and does so
identically everywhere.

---

## Phase 9: The Dictionary's Ceiling

**Purpose**: the phone found a second class of error the dictionary cannot fix — 你是那国人 read as
那 · 国人 — and measurement showed the cheap remedy does not fix it either. A contextual model does.

- [X] T061 Establish which rung actually fixes it, rather than assuming: run the frequency-weighted candidate against greedy matching on the failing cases and record that frequency scoring leaves 国人 unchanged (research.md R13)
- [X] T062 Measure every available model rather than trusting the register's 10–30 MB estimate — including that no tiny published Chinese segmentation model exists, that int8 quantisation costs albert-tiny the compound 自行车, and that CKIP's Traditional-trained models handle Simplified correctly (research.md R13)
- [X] T063 Decide and record in [ADR-0015](../../docs/adr/0015-a-contextual-model-fetched-on-demand.md), with the rejected alternatives and their measured costs
- [X] T064 [P] Commit the model's vocabulary via `scripts/build-bert-vocab.mjs`, asserting its size and special-token ids — a vocabulary of a different size is a different model, and mismatched ids produce confident nonsense rather than an error
- [X] T065 Write the tag decoder in `src/lib/analyzer/tagger.ts` with an injected tagging function, and prove in `tests/analyzer/tagger.test.ts` that no answer a model can give breaks tiling, coverage, offsets or unit boundaries — including `I` on a first character, which a quantised model really does emit
- [X] T066 [P] Write the character tokenizer in `src/lib/analyzer/bert-tokenizer.ts` and test in `tests/analyzer/bert-tokenizer.test.ts` that every character yields exactly one id, unknown characters included: dropping one would shift every later tag onto the wrong character
- [X] T067 Fetch and keep the model in `src/lib/analyzer/model-store.ts`, reporting progress and refusing to store a short read rather than leaving a truncated model that would load and produce nonsense
- [X] T068 Run the model in `src/lib/analyzer/bert-tagger.ts`, loading `onnxruntime-web` lazily and addressing its WebAssembly by explicit URL
- [X] T069 Keep the runtime in the build and out of the install: `scripts/copy-ort-runtime.mjs`, a precache exclusion, and the `onnxruntime-web-use-extern-wasm` resolve condition in `vite.config.ts` — without which Vite precaches the 26.5 MB jsep variant
- [X] T070 Redefine the install budget as precached bytes rather than build bytes in `scripts/check-bundle.mjs`, since the two stopped being the same thing
- [X] T071 Resolve the analyzer per call in `src/lib/analyzer/active.ts`, so the answer changes the moment a download finishes, and update every call site
- [X] T072 Offer the model on `src/routes/diagnostics/+page.svelte` with its price stated, beside the line showing what this device does with words
- [X] T073 Verify end to end in a browser that the model downloads, stores, activates and segments — the one path no unit test can reach
- [X] T074 On the phone: download the model over wi-fi, confirm 你是哪国人 reads 你 · 是 · 哪 · 国 · 人, and confirm it still works after aeroplane mode and a restart
- [X] T075 Record what the model changed, and whether the runtime-not-cached-offline gap named in ADR-0015 bites in practice

## Phase 10: What The Host Did To Our Own Files

- [X] T076 Fix the download against a host that compresses (research.md R14): trust `Content-Length` only when the response is not content-encoded, keep only the content type on the stored copy rather than headers describing a transfer that has already been undone, and stream into the cache instead of buffering 98 MB — with `tests/analyzer/model-store.test.ts` describing the host's measured behaviour rather than the test server's
- [X] T077 Re-run the end-to-end browser pass against a server that gzips the way GitHub Pages does. T073 passed against one that did not, which is why the failure reached the phone: the check was weaker than the thing it was checking
- [X] T078 Stop the activation sweep from deleting the model cache, and put the two load-bearing cache names behind one tested function in `src/lib/analyzer/model-cache.ts` — accepting an update was throwing away a 98 MB download the reader had waited for (research.md R15)
- [X] T079 Move the browser harness into `scripts/verify-in-browser/` behind `npm run verify:browser`, with a launcher that refuses to run on a build without `BASE_PATH`, on a debug port it cannot prove it owns, or against a server kinder than GitHub Pages — the three arrangements that each produced a failure indistinguishable from an application bug

**Checkpoint**: segmentation resolves the cases only context can resolve, and the reader who does not
want the download loses nothing.

---

## Dependencies & Execution Order

### Phase dependencies

- **Phase 1** is independent and can be done at any time; doing it first means the budget cannot be
  breached unnoticed while the rest is built.
- **Phase 2 blocks everything.** No story task can start before T013.
- **Phase 3 (US1)** depends only on Phase 2.
- **Phase 4 (US2)** depends on Phase 2, and on T014 for there to be a current analyzer to be stale
  against.
- **Phase 5 (US3)** depends on Phase 2 for the shipped candidate to be one of the things measured;
  T032–T036 could technically be written earlier, but the conclusion in T039 cannot be drawn until
  US1 ships something to conclude about.
- **Phase 7** requires everything.

### User story dependencies

These stories are **not** independent, and the spec says so. US1 and US2 share the analyzer; US3
measures what US1 ships. The one genuinely separable piece is the comparison harness itself
(T032–T036), which touches no application code at all.

### Within phases

- T003–T006 are parallel: four different test files.
- T008 and T009 are parallel: different new modules.
- T010 blocks T011 and T012 — both implement the interface it changes.
- T018–T020 are parallel and all precede T021.
- T024–T028 are sequential: they are the same file.

### Parallel opportunities

```text
Phase 2 tests:        T003  T004  T005  T006      (four files, no shared state)
Phase 2 modules:      T008  T009                  (after T007 lands the conversion)
Phase 4 tests:        T018  T019  T020            (three assertions, one file each)
Phase 5 harness:      T032  T033                  (entirely outside src/)
Phase 6:              T041  T042
```

---

## Implementation Strategy

### The order the plan recommends

Risk-first, which is not priority order. T003 and T007 — the offset conversion — come before
anything visible, because they are the only work in this slice that can corrupt data the reader
cannot get back, and because the defect is invisible on ordinary text. Slice 1's plan ordered itself
this way and it is why the lease bug surfaced with room to fall back.

After that the order is ordinary: analyzer, then the visible slice, then the measurement.

### MVP scope

**Phase 1 + Phase 2 + Phase 3 (US1)** is a coherent, shippable increment: real words in newly
imported documents. It would leave existing documents on the placeholder, which is why US2 follows
immediately rather than being optional.

**US3 is not optional either, despite being P3.** It is what makes the slice finished rather than
merely working, and FR-029 defines an absent conclusion as incomplete.

### Which tasks are delegated, and why most are not

Two agents are defined for this slice (`.claude/agents/`): `segmenter-comparison` for T032–T036 and
`test-auditor` for the audit half of T042. Everything else stays in the main session.

That is deliberate rather than conservative. The risk on this project is not that a task is hard —
it is that a plausible-looking answer is wrong in a way the constitution specifically forbids. The
offset conversion (T003, T007) is the only work here that can corrupt data the reader cannot get
back. The property tests (T004–T006, T018–T020) are exactly where an example-based assertion looks
most natural and is a defect. Re-derivation and the sweep (T021–T031) touch earned marks, transaction
atomicity and slice 1's storage lease. None of those fail loudly when done adequately-but-wrongly.

There is also a plain economic point: a subagent inherits none of this conversation, so each would
need the constitution, the relevant ADR and the contract re-explained. For a ten-line change to a
Svelte component, briefing costs more than doing it.

### Notes

- `character.ts` stays. It is the second implementation that makes seam 1 demonstrated rather than
  asserted, and Phase 4's tests need two analyzers to switch between. It stops being the default; it
  does not stop existing.
- Reuse `checkTiling` from `src/lib/domain/tiling.ts` (slice 0) rather than writing a new tiling
  check. It is already analyzer-agnostic and already tested, including that ends are measured in
  characters rather than UTF-16 code units.
- No migration file. Nothing changes shape; token rewriting is a recompute performed by application
  code inside a transaction (data-model.md).
- `reading_session` stays out. It was deferred deliberately on 2026-09-02 with the loss accepted, and
  it is not to be quietly pulled in here.
