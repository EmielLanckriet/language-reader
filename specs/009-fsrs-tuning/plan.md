# Implementation Plan: FSRS Tuning Foundation

**Branch**: main, existing checkout | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)

## Summary

Read-only vertical slice: retained encounters → repository → worker/client → Cards report and
export → laptop candidate evaluation. Production scheduling is unchanged. Fitting and reversible
parameter activation follow separately once the evidence/evaluation path can support them.

## Technical Context

TypeScript 6, Svelte 5, SQLite, ts-fsrs 5.4.2 (FSRS-6), Vitest/fast-check; no new dependency.
Existing Vite loads the domain module for the laptop CLI. Report/export runs on demand, restricted
to words with explicit reviews. No optimization/network submission on phone. Large histories may
take longer to export; normal Cards never waits on analysis. No database migration or new writes.

## Constitution Check

I: Installed-phone validation required before claiming shipped. II: Replay tests first, then
mutation checks. III: No Anki writes. IV: UI through persistence and usable export/evaluation.
V: Existing seams only; all new data derived, original earned inputs retained. VI: ADR-0033.
VII/VIII: One-pass replay using production fold, on-demand report. Post-design review passes;
deployment/device validation remains an explicitly open completion gate.

## Project Structure

- `src/lib/domain/memory.ts`: derived explicit-review identity and observation callback before
  updating a card in the existing fold; no second scheduler implementation.
- `src/lib/domain/tuning.ts`: versioned dataset, validation, split, exclusions and metrics.
- `src/lib/storage/{repository,client,protocol,worker}.ts`: read-only dataset wiring.
- `src/routes/cards/tuning/+page.svelte`: report/export; link from Cards.
- `scripts/fsrs/evaluate.mjs`: baseline/candidate comparison on laptop.
- `tests/domain/tuning.test.ts`, `tests/storage/tuning.test.ts`: focused validation.

## Validation

Fail focused tests before implementation. Mutate label selection, prediction timing and withdrawal
filtering to prove regression detection. Run focused tests, type check, build and isolated browser
report/export. No synthetic interactions on daily reader. Report phone validation separately.
