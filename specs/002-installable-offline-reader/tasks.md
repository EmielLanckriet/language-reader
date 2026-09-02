# Tasks: Installable, Offline, and Safe From Silent Loss (Slice 1)

**Input**: Design documents from `/specs/002-installable-offline-reader/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included where they earn their place. Constitution Principle II mandates test-first for a
closed list that does **not** name storage availability; plan.md records why it is written test-first
anyway — it decides whether earned data is kept, which is neither UI nor glue. Service worker
caching and manifest wiring are glue and are exempt, so they are verified by the checks in
quickstart.md rather than by unit tests.

**Organization**: Grouped by user story. The three stories in this slice are unusually independent —
offline caching, installability and the storage lease share almost nothing — so each can be built,
shipped and judged on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel — different files, no dependency on incomplete work
- **[Story]**: Which user story the task serves

## Path Conventions

Single SvelteKit application at the repository root: `src/lib/`, `src/routes/`, `static/`, `tests/`.
No backend directory, because there is no server (ADR-0007).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Remove the duplicate SQLite before anything starts caching it, and take manual control
of service worker registration. Nothing here is visible to a reader.

- [X] T001 Write `scripts/check-bundle.mjs` asserting that `build/` contains exactly one `sqlite3*.wasm` and exactly one `sqlite3-opfs-async-proxy*.js`, failing with both paths listed when it does not; wire it into the `postbuild` script in `package.json` beside `spa-fallback.mjs`. **Expected to fail on the current build** — that failure is the task's proof it works
- [X] T002 Create `src/lib/storage/persistence.ts` containing `requestPersistentStorage` and the `Persistence` type moved out of `src/lib/storage/db.ts`, importing nothing from `@sqlite.org/sqlite-wasm`
- [X] T003 Remove `requestPersistentStorage` and `Persistence` from `src/lib/storage/db.ts`, and point `src/lib/storage/session.ts` at `persistence.ts` for it — leaving `db.ts` reachable only from `worker.ts`. **The task named one culprit and there were four.** `client.ts` and `protocol.ts` already used `import type` and were erased; the real remaining paths were `client.ts`'s value import of `StorageFailure` from `repository.ts`, `ErrorNotice.svelte`'s import of the same, and both page routes importing `describeError` from `diagnostics/log.ts`. Resolved by extracting `src/lib/storage/failures.ts` and `src/lib/diagnostics/describe.ts`, each importing nothing
- [X] T004 Run `BASE_PATH=/language-reader npm run build` and confirm T001 now passes and total build size drops from ~2.6 MB to ~1.5 MB
- [X] T005 [P] Set `serviceWorker: { register: false }` in the `sveltekit()` options in `vite.config.ts`, with a comment saying why: FR-010 needs the registration object

**Checkpoint**: The build ships one copy of SQLite, and a regression would fail the build rather than pass unnoticed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: One shared place for the three notices each story adds. Small, but genuinely blocking —
without it, three stories each restructure the same layout file.

**⚠️ CRITICAL**: No user story work begins until this phase completes.

- [X] T006 Add a notice region to `src/routes/+layout.svelte` — a single slot above the routed page where install, update and read-only notices render in that order, with nothing rendered when there is nothing to say
- [X] T007 [P] Add notice styling to `src/lib/ui/app.css` — one informational variant and one warning variant, reusing the existing `--rule`, `--muted` and `--danger` tokens rather than introducing new ones

**Checkpoint**: The layout has a place for a notice and shows none.

---

## Phase 3: User Story 1 - Read on the metro (Priority: P1) 🎯 MVP

**Goal**: With the device fully offline, the reader opens the application, reads a saved document,
marks words, and finds the marks intact later.

**Independent Test**: Aeroplane mode, cold start, open a saved document, mark several words, close
and reopen. Needs neither the manifest nor the lease work.

### Implementation

- [X] T008 [US1] Write `src/service-worker.ts` `install` handler, letting a failure reject installation so a half-cached version never activates (FR-007). **`[...build, ...files]` was wrong and would have shipped broken.** `$service-worker`'s `build` omits `index.html` and everything Vite emits for a worker created with `new Worker(new URL(...))` — here, the shell and the entire storage worker including the 844 KB SQLite binary. Verified by diffing the emitted precache list against `build/`. The list now comes from `scripts/precache-manifest.mjs`, generated from the build directory itself
- [X] T009 [US1] Add the `activate` handler to `src/service-worker.ts`: delete every cache whose name is not the current one, then `clients.claim()`. Do **not** call `skipWaiting()` in `install` — see contracts/service-worker.md for why its absence is deliberate (FR-009)
- [X] T010 [US1] Add the `fetch` handler to `src/service-worker.ts`: ignore non-`GET`; serve from the cache when present; on a miss fall back to the network; for a navigation request that misses, serve the cached shell at `${base}/index.html` so deep links resolve offline
- [X] T011 [US1] Create `src/lib/ui/registerServiceWorker.ts` registering the worker with `{ type: 'module' }` and returning the `ServiceWorkerRegistration`, and call it from `src/routes/+layout.svelte` behind a `browser` guard
- [X] T012 [US1] Handle a first-ever visit with no network in `src/app.html`: inline markup and a small inline script that replaces it once the application boots, so the one thing always present on a cold visit can explain that nothing has been fetched yet (FR-008)
- [X] T013a [US1] Verify that offline capability costs the reader nothing beyond one visit: clear site data, load the application once, go offline, reload. It must work with no button pressed and nothing downloaded deliberately (FR-005, SC-007). The plausible failure is a reader who closes the tab before caching finishes, so also check what happens when the first visit is cut short
- [X] T013 [US1] Verify quickstart checks 4, 6 and 7 locally — 28 cached entries including the WebAssembly binary, offline reload renders the library, and an offline hard load of `/language-reader/read/1` renders from the shell

**Checkpoint**: The application works with the network disabled, including deep links. This alone is the largest gap between slice 0 and a usable tool.

---

## Phase 4: User Story 2 - It behaves like an app, not a page (Priority: P2)

**Goal**: The reader installs the application to their home screen and it opens in its own window.

**Independent Test**: Install to the home screen, close the browser entirely, tap the icon.

### Implementation

- [X] T014 [P] [US2] Generate `static/icon-192.png`, `static/icon-512.png` and `static/icon-maskable-512.png` from `src/lib/assets/favicon.svg`, giving the maskable variant the safe-zone padding Android's launcher crop requires. Name the tool used and justify it per Principle V, or produce the files by hand and record that instead — an undeclared image dependency is still a dependency
- [X] T015 [US2] Write `static/manifest.webmanifest` per contracts/web-app-manifest.md — `start_url` and `scope` both `"./"`, icon `src` values with no leading slash, `display: standalone`
- [X] T016 [US2] Write `tests/build/manifest.test.ts` asserting that no member URL in `static/manifest.webmanifest` begins with `/`, and that both a 192px and a 512px icon are declared. This is the one manifest failure invisible locally, because the base path is empty in development
- [X] T017 [US2] Add `<link rel="manifest" href="%sveltekit.assets%/manifest.webmanifest" />` and a `theme-color` meta to `src/app.html`
- [X] T018 [US2] Create `src/lib/ui/InstallOffer.svelte`: capture `beforeinstallprompt`, prevent its default, hold the event, render an offer while it is held, call `prompt()` when tapped, and clear on `appinstalled` or when `matchMedia('(display-mode: standalone)')` matches (FR-003a)
- [X] T019 [US2] Render `InstallOffer` in the notice region of `src/routes/+layout.svelte`
- [X] T020 [US2] Verify quickstart checks 1, 2 and 3 locally against a `BASE_PATH=/language-reader` build — relative members, manifest reachable, and DevTools reporting no installability errors. **Partly done: 1 and 2 pass** (`tests/build/manifest.test.ts`, and the built shell links `/language-reader/manifest.webmanifest`). Check 3 is blocked until US1 ships a service worker with a fetch handler, without which no browser reports the application as installable — the dependency noted below, met in practice

**Checkpoint**: DevTools reports the application as installable, and the offer appears. Per FR-003b, an absence here is a defect rather than a browser preference.

---

## Phase 5: User Story 3 - Never lose a mark to a second copy (Priority: P3)

**Goal**: A copy that cannot reach durable storage refuses every change and says why, rather than
accepting changes it will discard.

**Independent Test**: Open the application in two visible windows. The one without the lease says it
cannot save, refuses a mark and a document, and recovers when the other is closed or hidden.

### Tests first (Principle II, per plan.md)

> Written before the implementation and expected to fail. That failure is the point.

- [ ] T021 [P] [US3] Write failing tests in `tests/storage/availability.test.ts` for every transition in data-model.md, asserting each of the five invariants by name: writes accepted in exactly one state; no event named for a timer, which is FR-015a stated as a property rather than a promise; a remembered change carried out at most once and only on success; `refused` reachable back to `acquiring` by all three events; and every `refused` carrying a cause
- [ ] T022 [P] [US3] Write failing tests in `tests/storage/availability.test.ts` for `explain(cause)`, asserting that `another-copy` and `unavailable` produce **different** actions for the reader, and that `unknown` states its uncertainty and carries the recorded detail (FR-013)

### Implementation

- [ ] T023 [US3] Implement `src/lib/storage/availability.ts` per contracts/storage-availability.md — `Availability`, `Cause`, `Event`, `Effect`, `next`, `acceptsWrites`, `explain`. Imports nothing
- [ ] T024 [US3] Make `src/lib/storage/db.ts` open-and-close repeatable: expose closing the connection separately from tearing down the VFS, and return the pool utility so the caller can pause and unpause it
- [ ] T025 [US3] Implement `src/lib/storage/lease.ts` in the worker: `acquire()` takes the Web Lock with `{ ifAvailable: true }`, then installs or unpauses the VFS and opens the database; `release()` closes the database **then** calls `pauseVfs()` — in that order, because the library throws if handles are open
- [ ] T026 [US3] Classify failures in `src/lib/storage/lease.ts` into the three causes per contracts/storage-availability.md: a refused lock is `another-copy`, an acquired lock over a throwing VFS is `unavailable` with the thrown message, and anything else is `unknown` with what was recorded
- [ ] T027 [US3] Extend `src/lib/storage/protocol.ts` with `visibility`, `retry` and `availability` messages
- [ ] T028 [US3] Drive the state machine from `src/lib/storage/worker.ts`: hold the current `Availability`, apply `next()` on each event, perform `acquire` and `release` effects, and push every change to the page
- [ ] T028a [US3] Queue **reads** in `src/lib/storage/worker.ts` while the state is `acquiring` or `paused`, releasing them once `holding` is reached. Only writes are refused. Without this, every return to the foreground resolves reads against a database that is not open yet, and the reader sees an empty library — which is indistinguishable from having lost everything
- [ ] T029 [US3] Gate every write in `src/lib/storage/worker.ts` on `acceptsWrites`: when false, raise `reader-attempted-change`, await the attempt, then either perform the call or reject it — so the caller never receives a success that will not be kept (FR-012, FR-015, FR-016)
- [ ] T029a [US3] Make a write that fails for any other reason — storage exhausted while marking offline is the spec's named case — surface as a refusal naming its cause, in `src/lib/storage/worker.ts` and `src/lib/storage/client.ts`. The lease state machine covers being unable to *reach* storage; it does not cover storage refusing a write once reached, and FR-016 forbids reporting either as saved
- [ ] T030 [US3] Forward visibility from `src/lib/storage/session.ts`: send `visibility` on `document.visibilitychange` and once at startup, and expose the pushed `availability` to the interface
- [ ] T031 [US3] Surface availability through `src/lib/storage/client.ts` as reactive state, and reject write methods with a typed refusal rather than a generic error
- [ ] T031a [US3] Render a resuming state rather than an empty one while availability is `acquiring`, in `src/routes/+page.svelte` and `src/routes/read/[id]/+page.svelte`. This is **not** a rare path: tying the lease to visibility means every return to the foreground passes through it, so it is the state the reader will meet most often after `holding`
- [ ] T032 [US3] Create `src/lib/ui/ReadOnlyNotice.svelte` rendering `explain(cause)` — headline, action, and the recorded detail when present — with a retry control that sends `retry` (FR-013, FR-015). Render it in the notice region of `src/routes/+layout.svelte`
- [ ] T033 [US3] Show the read-only cause in `src/routes/diagnostics/+page.svelte` under "Right now", replacing slice 0's fixed sentence that always blamed another copy
- [ ] T034 [US3] Verify quickstart checks 10, 11 and 12 locally with two visible windows, and confirm that switching between them moves the lease

**Checkpoint**: A copy without the lease accepts nothing and explains itself; the visible copy always works.

---

## Phase 6: Cross-Cutting Requirements

**Purpose**: Requirements that serve no single story. FR-009 to FR-011 are here because the spec
includes them before they are used; FR-017 and FR-018 because they are about honesty rather than
about any one capability.

- [ ] T035 Add a `skip-waiting` message handler to `src/service-worker.ts` calling `skipWaiting()` (FR-010)
- [ ] T036 Create `src/lib/ui/UpdateOffer.svelte`: watch the registration for `waiting` and for `updatefound`, offer the move, post `skip-waiting` when accepted, and reload on `controllerchange`. Render it in the notice region (FR-009, FR-010)
- [ ] T037 Verify FR-011 by counting documents, marks and history entries before and after accepting a version change, per quickstart checks 8 and 9 (SC-003)
- [ ] T038 Make the disabled save control explain itself in `src/routes/+page.svelte` — say that there is nothing to save yet, rather than leaving a dead control (FR-017, resolving the question inherited from slice 0)
- [ ] T039 Add a permanent line to `src/routes/diagnostics/+page.svelte` stating that word marks made now are provisional and may not survive real segmentation, and that documents are not provisional and are never discarded. No first-run notice, and no interruption anywhere else (FR-018)
- [ ] T040 [P] Update `README.md` with what the application now is: installable, offline, and single-writer

---

## Phase 7: Deploy And Phone Check (Principle I)

**Purpose**: The gate. Nothing in this slice is complete until the phone says so, and SC-008 says so
in the spec's own words.

- [ ] T041 Merge to `main` and confirm the deploy workflow succeeds with `npm run check`, `npm run lint`, `npm test` and `check-bundle` all passing
- [ ] T042 On the phone: the application offers to install itself, without going through a browser menu, and complete the installation in under two minutes without consulting instructions (P1 — FR-003a, FR-003b, SC-006)
- [ ] T043 On the phone: the installed icon shows a real name and image, with no white bounding box (P2 — FR-003)
- [ ] T044 On the phone: tapping the icon opens the application with no address bar and no tab strip, on the library rather than a missing page (P3, P4 — FR-001, FR-002, SC-002)
- [ ] T045 On the phone: **restart the device**, enable aeroplane mode, open the application, and read a saved document within 30 seconds (P5, P8 — FR-004, SC-001). Run this one first; it is the constitutional requirement, it is what slice 0 got wrong, and it is the slowest to discover late
- [ ] T046 On the phone, offline: mark words, close, reopen, confirm the marks are there; and paste and save new text (P6, P7 — FR-004, FR-006, SC-005)
- [ ] T047 On the phone: open the installed application and the same URL in Chrome, and confirm the one in front works while the other says it cannot save — and that it says so within 5 seconds of opening, and in place of the library rather than over an empty one (P9 — FR-012, FR-013, FR-014, SC-004)
- [ ] T048 On the phone: confirm the device-information view states that marks are provisional and documents are not (P10 — FR-018)
- [ ] T049 On the phone: deploy a new version while the application is open, confirm nothing changes until asked, then accept and confirm every document and mark survives (P11, P12 — FR-009, FR-010, FR-011, SC-003)
- [ ] T050 Record what the phone check revealed in `docs/anticipated-changes.md`, whether or not it revealed anything — including whether `pauseVfs`/`unpauseVfs` behaved as documented across a real backgrounding, which is the one part of this slice resting on documentation rather than measurement
- [ ] T051 Close slice 0's outstanding T043 while the phone is in hand: paste more than 5,000 characters and confirm the refusal message is legible on a phone screen

**Checkpoint**: SC-008 satisfied. The slice is complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies. T002 → T003 → T004 are strictly sequential; T001 precedes them so its failure is observed. T005 is independent
- **Foundational (Phase 2)**: Depends on Setup. Blocks all three stories, because all three add a notice to the same file
- **User Stories (Phases 3–5)**: All depend on Phase 2 and on nothing else. **They do not depend on each other**
- **Cross-Cutting (Phase 6)**: T035–T037 depend on US1's service worker. T038–T040 depend on nothing
- **Phone Check (Phase 7)**: Depends on everything, and on a deploy

### User Story Dependencies

- **US1 (P1)** — needs only the service worker. Independent of the manifest and the lease
- **US2 (P2)** — needs the manifest, icons and the install offer. Note that a browser will not report the application as installable until a service worker with a `fetch` handler exists, so T020's local check wants T010 done; the *code* is independent, the *verification* is not
- **US3 (P3)** — needs the lease. Independent of both others

### Within Each User Story

- US3's tests (T021, T022) are written and failing before T023
- `db.ts` becoming open-and-closeable (T024) precedes `lease.ts` (T025)
- The worker drives the machine (T028) before writes are gated on it (T029)
- Interface tasks come last within each story, once the states they report exist

### Parallel Opportunities

- T001 and T005 in Setup
- T006 and T007 in Foundational
- T021 and T022 — different concerns, same new file, so write them together
- T014 (icons) alongside any of US1
- The three stories in their entirety, if there were more than one person

---

## Implementation Strategy

### The order the plan recommends, which is not priority order

Phases are numbered by the spec's priorities. The plan's implementation order deliberately differs,
and the difference is a free choice because the stories are independent:

1. **Phase 1** — always first. Everything after it caches or ships the build
2. **Phase 4 (US2)** — cheap, and the fastest route to a visibly different phone. Slice 0's most
   demoralising property was that it looked finished and was not
3. **Phase 5 (US3)** — the riskiest work, placed early enough that discovering `pauseVfs` misbehaves
   on the device still leaves room to fall back to exclusion-only and amend FR-014
4. **Phase 3 (US1)** — the largest value, and the least uncertain
5. **Phases 6 and 7**

If you would rather have the P1 value first, do Phase 3 before Phase 4. Nothing breaks; the only
cost is finding out about the lease later.

### MVP scope

**Phase 1 + Phase 2 + Phase 3 (US1).** That is a reader who can read offline — which is the
constitutional requirement and the largest single gap between slice 0 and a daily tool. It is
shippable without the manifest and without the lease, and it is worth shipping there.

The two stories after it are not decoration: US2 is what makes the reader reach for it, and US3 is
what stops it quietly losing work. But either can slip a day without the tool being unusable, and
US1 cannot.

### Notes

- Commit after each task or logical group
- Verify US3's tests fail before implementing T023
- Stop at any checkpoint; each is a real place to stand
- Anything that pushes a change into `src/lib/domain/` is a signal the seam has failed, and the fix
  is there rather than here
