# Implementation Plan: Personal FSRS fitting with in-context outcomes

**Branch**: main, existing checkout | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary

Four vertical slices, each deployable. (1) `evidence-3`: words under shown English get no credit,
a tap is a tap (undo while the sheet is open), and evaluation scores in-context outcomes beside
card grades through a format-2 export. (2) An own FSRS-6 replay engine, shared by production
memory and a laptop fit of 21 weights + 3 rule multipliers + 2 outcome reliabilities, with a
prior on the Anki weights and a chronological verdict. (3) Apply/roll back in Reader as
append-only activations, memory recomputed by the existing background sweep. (4) The same fit in
a supervised worker on the phone, built only after measuring it there. See [research](research.md).

## Technical Context

TypeScript 6, Svelte 5, SQLite in a worker (OPFS), ts-fsrs 5.4.2, Vitest + fast-check; no new
dependency. Laptop commands load domain modules through Vite as `evaluate.mjs` does. Fit cost
measured at 0.72 ms per simple 5,000-event replay on the laptop; phone cost unmeasured (Story 4
gate). Memory recompute reuses the 200-word sweep; full rebuild estimated ~12 s on the phone,
unmeasured. No database migration: two new encounter kinds, which backups already carry.

## Constitution Check

- I: each slice deploys and is checked on the A71; Story 4 starts with a phone measurement.
- II (scheduling logic): test-first for `evidence-3`, the engine (against ts-fsrs), outcomes,
  activation and rollback; property tests for helped/tap rules; mutation checks for each.
- III: Anki is read for its weights only; nothing is written to it.
- IV: every slice reaches the UI (report, word sheet, Apply, Fit).
- V: no new seam; engine and fit live in the domain core, free of storage and framework. New
  earned data: two append-only kinds, shapes settled here. Everything else derived.
- VI: [ADR-0037](../../docs/adr/0037-in-context-outcomes-and-fitted-rules.md), revising ADR-0033.
- VII: finite differences over hand-derived gradients; one engine instead of two schedulers.
- VIII: memory keeps serving old rows while the sweep recomputes; a fit never blocks reading.

Post-design re-check: passes. Open gates: phone validation per slice; Story 4 measurement.

## Project Structure

- `src/lib/domain/memory.ts` → `evidence-3` (Story 1), then delegating to the engine (Story 2).
- `src/lib/domain/helped.ts`: helped spans per session from translation/setting encounters.
- `src/lib/domain/items.ts`: item stream and outcomes (data-model).
- `src/lib/domain/fsrs6.ts`: unrounded FSRS-6 steps + the three rule multipliers.
- `src/lib/domain/fit.ts`: objective, prior, projected Adam, split, bootstrap verdict.
- `src/lib/domain/tuning.ts`: format 2, in-context metrics.
- `src/lib/storage/repository.ts` (+ client/protocol/worker): item export, helped resolution,
  activations, `currentParameters` ordering fix, `ruleKey` with set id.
- `src/lib/ui/recorder.ts`, `StateMenu.svelte`, `routes/read/[id]`: undo tap, remove "I knew it".
- `src/routes/cards/tuning/+page.svelte`: import, report, Apply, history, Fit.
- `src/lib/fit-worker.ts`: Story 4 worker under `inferenceBudget`.
- `scripts/fsrs/fit.mjs`, `scripts/fsrs/README.md`.
- Tests: `tests/domain/{evidence,fsrs6,fit,tuning}.test.ts`, `tests/storage/{helped,activation,tuning}.test.ts`.

## Validation

See [quickstart](quickstart.md). Tests fail before implementation; each rule mutated once.
Isolated browser and isolated phone only for synthetic activity. Phone checks batched per slice.
