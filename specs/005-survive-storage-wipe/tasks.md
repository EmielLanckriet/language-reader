---
description: "Tasks for 005 — the reader's work survives a storage wipe"
---

# Tasks: The Reader's Work Survives A Storage Wipe

**Input**: `specs/005-survive-storage-wipe/` — plan.md, spec.md, research.md, data-model.md,
contracts/copy-format.md, contracts/reader-service.md, quickstart.md

**Tests**: Required for restore. It writes earned data, and event replay is on Principle II's
mandatory list. Restore tests are written **first**, and each is **made to fail by a mutation**
before it is kept (CLAUDE.md). Sending, warnings and the service are glue: one plumbing
scenario (`wipe`), no suite.

**Keep checks short**: fixtures of a few documents and dozens of events; every browser check
around a minute.

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Create `src/lib/backup/` and `tests/backup/`, and `tests/fixtures/copies/` for format fixtures kept forever (SC-005)

---

## Phase 2: Foundational (blocks all stories)

- [X] T002 [P] Define the copy type (format 1, per data-model.md), canonical JSON (keys sorted at every level), and `integrity` = SHA-256 hex, in `src/lib/backup/format.ts`. Pure; Web Crypto in the browser, `node:crypto` under vitest
- [X] T003 Add `exportCopy(): Copy` to `src/lib/storage/repository.ts`: one read transaction over devices, documents (+ media subtitle text and meta from `media/<id>/`, read on the page side and merged in `src/lib/backup/destination.ts`), events in log order with lexemes as `(language, surface)`, and states. Refuse, and record a diagnostic, when `states` ≠ the replay of `events` (copy-format.md, Writing 2)
- [X] T004 Carry `exportCopy` and (later) `restoreCopy` across the worker boundary in `src/lib/storage/protocol.ts`, `src/lib/storage/worker.ts`, `src/lib/storage/client.ts`
- [X] T005 [P] Write `scripts/termux/reader-service.py` per contracts/reader-service.md: `PUT/GET /backup`, `GET /backup/latest`, `GET /downloads/...`, `GET /media/<youtubeId>`, `GET /health`, with CORS and private-network headers, atomic writes, integrity check on PUT, and retention (20 recent + 30 daily). `--root` for tests
- [X] T006 [P] Update `scripts/termux/setup.sh`: install the service to `~/bin/`, a Termux:Boot script `~/.termux/boot/reader-service`, and a `~/.bashrc` guard that starts it when Termux opens and it is not running (research R7). Update `scripts/termux/termux-url-opener` to record `job` in `meta.json` (R8), and remove `transcribe.py`'s own server now that the service serves `/downloads` (R3)

**Checkpoint**: `curl` checks in quickstart.md §Service pass.

---

## Phase 3: User Story 1 — My work comes back after a wipe (P1) 🎯 MVP

**Goal**: an empty library offers the latest copy; restoring it brings every mark, event and document back exactly.
**Independent test**: quickstart.md §Unit, then the `wipe` scenario once Phase 4 sends copies (until then, seed the service with `curl -X PUT`).

### Tests first — each must fail before the code exists, and fail again under a mutation

- [X] T007 [P] [US1] Round-trip property in `tests/backup/roundtrip.test.ts`: generated histories (fast-check: documents, surfaces, devices, marks with occurrences) → `exportCopy` → `restoreCopy` into `freshDatabase()` (tests/storage/support.ts) → identical events (order, device seq, occurrence), states, documents. Mutation to try: drop `provenance`, or restore events out of order
- [X] T008 [P] [US1] Tamper and truncate in `tests/backup/validation.test.ts`: one flipped character, a cut file, an unknown `format`, and an event naming a missing document each make `restoreCopy` refuse with the failing check named, and leave the database identical (compare a full dump before and after). Mutation: skip the integrity check
- [X] T009 [P] [US1] Non-empty refusal in `tests/backup/refusal.test.ts`: any word state or event present → refuse and write nothing; documents only → allowed after confirmation. Mutation: remove the guard
- [X] T010 [US1] Generate `tests/fixtures/copies/format-1.json` from a scripted history via `exportCopy`, commit it, and add `tests/backup/formats.test.ts` restoring every `format-*.json` (SC-005)

### Implementation

- [X] T011 [US1] `restoreCopy(copy)` in `src/lib/storage/repository.ts` per copy-format.md, Restoring 1–3: validate, refuse if non-empty, then one transaction for devices, documents (ids kept), lexemes by `findOrCreateLexeme`, events in order, `rebuildProjection`, and a check that states equal `copy.states` or the transaction rolls back. `upgrade` steps (none yet) in `src/lib/backup/format.ts`
- [X] T012 [US1] After commit, in `src/lib/backup/destination.ts`: tokenise restored documents with the fast analyzer, write each media document's subtitle file and meta to `media/<id>/` (ADR-0018), then ask `GET /media/<youtubeId>` and re-import the video from the bundle when found (R8). Failures leave readable documents
- [X] T013 [US1] `latest()` and `list()` against the service in `src/lib/backup/destination.ts`, telling "service unreachable" (`/health` fails) from "no copy yet" (404)
- [X] T014 [US1] Restore offer on an empty library in `src/routes/+page.svelte`: the copy's date, document and word counts, Restore / Not now. If the service is unreachable, say so and "open Termux once", instead of an empty-library look (FR-006)
- [X] T015 [US1] A restored media document whose video was not found says so on `src/routes/read/[id]/+page.svelte`, and reads without it (US1 scenario 3)

**Checkpoint**: T007–T010 green, each seen red. A copy seeded with `curl` restores in the emulator.

---

## Phase 4: User Story 2 — The copy keeps itself up to date (P1)

**Goal**: copies go out with no action from the reader, at most 5 minutes behind.
**Independent test**: the `wipe` scenario.

- [X] T016 [US2] `send(copy)` in `src/lib/backup/destination.ts` (PUT /backup), recording the last successful send time in `localStorage` (data-model.md; losing it only errs toward warning)
- [X] T017 [US2] `src/lib/backup/scheduler.ts`: after an earned change (`saveDocument`, `assertState`, and restore itself), send 30 s after the last change, on `visibilitychange` to hidden, and every 5 minutes while unsent (R4). The delays can be overridden for the harness. Start it from `src/routes/+layout.svelte`
- [X] T018 [US2] `wipe` scenario in `scripts/verify-in-browser/harness.mjs`: mark two words, wait for the copy (short delay), clear the origin's storage with `Storage.clearDataForOrigin`, reload, accept the restore, and check both marks and their history. Needs the service reachable on 127.0.0.1:8765. Make it fail once (disable the send)

**Checkpoint**: `wipe` passes on the emulator in about a minute, against the deployed app and a local build.

---

## Phase 5: User Story 3 — I am told when my data is at risk (P2)

**Goal**: each unprotected state is named on the first screen, with one action; none is shown when all is well.
**Independent test**: quickstart.md §Warnings.

- [X] T019 [P] [US3] `src/lib/backup/safeguards.ts`: installed (`display-mode: standalone`), protection (`persisted()`), copy (fresh / stale / never / service unreachable)
- [X] T020 [US3] `src/lib/ui/SafeguardNotice.svelte` in the layout: one distinct warning per unprotected state, each naming one action (FR-011). It replaces the home page's current persistence warning
- [X] T021 [US3] `src/routes/diagnostics/+page.svelte`: state of each safeguard, time and size of the last copy, and Restore at any time (FR-012), with the same refusal rules
- [X] T022 [US3] Measure what `display-mode` a Chrome shortcut reports in the emulator (R5), and record it in research.md R5

---

## Phase 6: Polish

- [X] T023 [P] Update `scripts/android-emulator/README.md` (running the service for `wipe`), the register (`docs/anticipated-changes.md`: backup built) and `docs/backlog.md` (store-wipe item → what is still unknown: the original cause, the phone)
- [X] T024 Run `npm run check`, `npm run lint`, `npm test`, and `media`, `live`, `wipe` on the emulator one at a time (a 20 s pause between them), then commit
- [ ] T025 On the phone, when available (not blocking): install Termux:Boot, reboot, confirm the service is up and a copy arrives; note the app's safeguard state, which may reveal the original wipe's cause

---

## Dependencies & Execution Order

- Phase 2 before everything. T002, T005, T006 are parallel; T003 → T004.
- **US1** needs Phase 2. Tests T007–T009 are parallel, then T010, then T011 → T012 → T013 → T014 → T015.
- **US2** needs T013's destination and T011's restore (for `wipe`). T016 → T017 → T018.
- **US3** needs only Phase 2 and T013 (copy freshness). It can run beside US2.
- Polish last.

## Parallel Example: User Story 1

```text
T007 roundtrip.test.ts  |  T008 validation.test.ts  |  T009 refusal.test.ts
```

## Implementation Strategy

**MVP = Phase 2 + US1**: a copy can be sent by hand (`curl`) and restored exactly. That already
makes a wipe recoverable. US2 makes it automatic; US3 makes the risk visible. Commit after each
phase; one deploy at the end of US2, per CLAUDE.md's batching of phone-bound work.
