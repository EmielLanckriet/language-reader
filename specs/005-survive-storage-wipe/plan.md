# Implementation Plan: The Reader's Work Survives A Storage Wipe

**Branch**: `005-survive-storage-wipe` (work on `main`) | **Date**: 2026-09-25 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/005-survive-storage-wipe/spec.md`

## Summary

The storage worker takes a snapshot of earned data and retained inputs as one versioned JSON copy.
The page sends it to a Termux service on `127.0.0.1:8765`, started at boot. When the app opens to
an empty library, it offers the service's latest copy. It restores it in one transaction and checks
the result by replaying the event log. Warnings name each unprotected state. No migration, and no
new dependency. Research is in [research.md](research.md), the format in
[contracts/copy-format.md](contracts/copy-format.md), and the service in
[contracts/reader-service.md](contracts/reader-service.md).

## Technical Context

**Language/Version**: TypeScript (SvelteKit app), Python 3 (the Termux service), bash (setup)
**Primary Dependencies**: none new. Hashing is Web Crypto `SHA-256` in the browser and `hashlib` in Termux
**Storage**: SQLite in OPFS, unchanged, with no migration. Copies are JSON files under `~/.reader/backups/` in Termux
**Testing**: vitest + fast-check for export and restore; one browser scenario (`wipe`) for the plumbing
**Target Platform**: Chrome on Android, installed, with Termux + Termux:Boot
**Project Type**: offline-first web app plus an on-device companion service
**Performance Goals**: making a copy never delays marking (SC-003); the copy is at most 5 min behind (SC-002)
**Constraints**: offline-first; no server (ADR-0007); the restore is all or nothing (FR-008)
**Scale/Scope**: one reader; copies of kilobytes to a few MB; 20 recent copies plus 30 daily ones kept

## Constitution Check

| Principle | Status |
|---|---|
| I. Ships to the phone | Emulator-verified at most, until the reader has the phone. Recorded as open, as in 004's and ADR-0019's slices |
| II. Test-first on state transitions | **Applies in full.** Restore writes earned data, and "event replay reproduces status" is on the mandatory list. Export → restore round-trip, tampered and truncated copies, the non-empty refusal and old formats are all property- or fixture-tested *first*, and each test is made to fail by mutation before it is kept. Sending, warnings and the service are glue: one plumbing scenario |
| III. Anki read-mostly | Not touched |
| IV. Vertical slice | Worker (export and restore), service, and UI (warnings, restore offer) ship together |
| V. Seams | The copy's destination sits behind one small interface (`send`, `latest`, `list`), so the deferred "back up now" file export is a second implementation, not a rewrite |
| VI. ADR during planning | [ADR-0020](../../docs/adr/0020-earned-data-copied-to-termux.md), written with this plan. ADR-0017/0018 were written after their code; not repeated here |
| VII. Verified kernels | Not touched |

**Gate: passes.** Nothing needs a complexity justification.

## Project Structure

### Documentation (this feature)

```text
specs/005-survive-storage-wipe/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
└── contracts/copy-format.md, contracts/reader-service.md
```

### Source Code (repository root)

```text
src/lib/backup/
├── format.ts         # the copy's type, canonical JSON + integrity, upgrade steps (pure)
├── destination.ts    # the seam: send / latest / list, Termux implementation
└── scheduler.ts      # when to send: 30 s quiet, background, every 5 min
src/lib/storage/
├── repository.ts     # + exportCopy() (read transaction), + restoreCopy() (one write transaction)
└── protocol.ts, client.ts, worker.ts   # + the two calls across the worker boundary
src/lib/ui/SafeguardNotice.svelte       # the warnings (FR-011), in the layout
src/routes/+page.svelte                 # restore offer on an empty library (FR-006)
src/routes/diagnostics/+page.svelte     # safeguard state and restore at any time (FR-012)
scripts/termux/reader-service.py        # the service; setup.sh installs it and its boot script
tests/backup/                           # round-trip, tamper, refusal, formats (test-first)
tests/fixtures/copies/format-1.json     # kept forever (SC-005)
scripts/verify-in-browser/harness.mjs   # + `wipe`: mark → copy → clear site data → restore
```

**Structure Decision**: the existing single project. The copy logic is its own folder because it is
a seam (V); the restore lives in the repository because it writes earned data, and
the repository is the only thing that does.

## Complexity Tracking

None.
