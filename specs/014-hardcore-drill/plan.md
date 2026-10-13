# Implementation Plan: Hardcore mode

**Branch**: main, existing checkout | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

## Summary

One session engine: a fragment of a document cut into parts, each running the chosen steps
(English preview → watch first → drill → watch after). Drill grades are reviews labelled hardcore
in a `hardcore` session, beside a plan record and step records; they update memory and the fit
like any review, but a word they touch joins Cards only once drilled in (reading stability ≥ 14
days from its first drill on). Drilled lines count as seen before for `evidence-4`. The player
gains a from–to-then-back mode, Cards' faces become a shared component. See
[research](research.md), [ADR-0041](../../docs/adr/0041-hardcore-drill-reviews.md).

## Technical Context

TypeScript 6, Svelte 5 / SvelteKit 2, SQLite in a worker (OPFS), ts-fsrs 5.4.2, Vitest 4 +
fast-check 4; no new dependency. No migration: new encounter kinds and a new session modality are
data (R1). One background recompute of every memory for the rule key change (R3), by the existing
sweep. Planning a film's parts is one pass over its tokens; unmeasured on the phone until the
phone round (R10).

## Constitution Check

- I: one deploy and one phone round at the end (the reader chose one spec, not slices).
- II (review scheduling, earned replay): memory rule test-first with exact assertions and mutation
  checks; parts and filters by properties (derived); one test for the drill queue; UI exempt.
- III: Anki is not touched; a hardcore review stops later Anki seeds exactly as any in-app review.
- IV: the feature spans records, repository, domain and three screens; deployable as one.
- V: no new seam. Earned shapes settled in the [contract](contracts/hardcore-records.md) before
  the first row. Plan, steps and reviews are earned; parts, classes and progress are derived. The
  domain module stays free of storage and framework.
- VI: ADR-0041.
- VII: one engine instead of modes; a reviewed-card row for drilled-in words rather than a new code.
- VIII: nothing slow is waited on: the plan is computed from rows already derived.

Post-design re-check: passes. Open gate: phone round (Principle I).

## Project Structure

- `src/lib/domain/memory.ts`: hardcore reviews excluded from `card`/`reviewed`/`reviewedSince`;
  drilled in tracked in the reading fold; `DRILLED_IN_DAYS`; `ACTIVATION` key.
- `src/lib/domain/encounter.ts`: `hardcore-plan`, `hardcore-step`, `hardcore-watch` kinds and
  validation; hardcore review fields.
- `src/lib/domain/hardcore.ts` (new): word filters, order, cut by load, drill queue, next step.
- `src/lib/storage/repository.ts` (+ client/protocol/worker): drill lines as viewings in
  `wordHistory`; first reviews today; `hardcoreWords`, `hardcoreSession`.
- `src/lib/ui/CardFace.svelte` (new, extracted from `routes/cards/+page.svelte`).
- `src/routes/document/[id]/+page.svelte`: a Hardcore entry.
- `src/routes/document/[id]/hardcore/+page.svelte` (new): options, word count, parts; starts a
  session.
- `src/routes/hardcore/[session]/+page.svelte` (new): runs the steps from the records: preview,
  links to the player/reader, the drill.
- `src/routes/read/[id]/+page.svelte`, `src/lib/ui/MediaReader.svelte`, `src/lib/ui/recorder.ts`:
  `until`/`back`/`step` (video), `from`/`to`/`back` (text), the `hardcore-watch` link.
- Tests: `tests/domain/memory.test.ts`, `tests/domain/hardcore.test.ts` (new),
  `tests/domain/encounter.test.ts`, `tests/storage/hardcore.test.ts` (new),
  `tests/storage/rewatch.test.ts`, `tests/storage/cards.test.ts`.
- Browser: `hardcore` scenario (new) in `scripts/verify-in-browser/harness.mjs`.
- Docs: ADR-0041; `docs/anticipated-changes.md` (spec 014 rows); `docs/current-state.md` and
  `docs/backlog.md` at the end.

## Validation

See [quickstart](quickstart.md). Earned-data tests fail before implementation; each rule mutated
once. Browser scenarios only those the change can reach. Phone checks batched in one round.
