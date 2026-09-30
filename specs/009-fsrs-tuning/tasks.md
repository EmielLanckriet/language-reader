# Tasks: FSRS Tuning Foundation

## Setup
- [x] T001 Specify/clarify evidence outcome in specs/009-fsrs-tuning/spec.md.
- [x] T002 Plan replay/evaluation boundary in specs/009-fsrs-tuning/plan.md and docs/adr/0033-fsrs-tuning-outcomes.md.

## Foundation
- [x] T003 Write failing replay/label/metric/validation tests in tests/domain/tuning.test.ts.
- [x] T004 Add pre-update observation to production fold in src/lib/domain/memory.ts and metrics in src/lib/domain/tuning.ts.

## US1: Understand and export evidence
Independent check: empty report then isolated history, withdrawal exclusion, no database changes.
- [x] T005 [US1] Write storage integration test first in tests/storage/tuning.test.ts.
- [x] T006 [US1] Wire read-only dataset through src/lib/storage/{repository,client,protocol,worker}.ts.
- [x] T007 [US1] Add report/export in src/routes/cards/tuning/+page.svelte and Cards link/grading guidance.

## US2: Compare candidates
Independent check: baseline/candidate CLI output uses the same outcomes and disjoint periods.
- [x] T008 [US2] Add laptop evaluator and usage in scripts/fsrs/evaluate.mjs and scripts/fsrs/README.md.

## Validation and delivery
- [x] T009 Mutate relevant code to demonstrate failures; focused tests, type check and isolated browser verification. Record in specs/009-fsrs-tuning/quickstart.md.
- [x] T010 Update docs/current-state.md and docs/anticipated-changes.md with evidence and remaining work.
- [ ] T011 Deploy and verify installed phone behavior; record results in docs/current-state.md.

Dependencies: T001–T004 → T005–T007 → T008 → T009–T011. No parallel implementation needed;
US2 documentation can be drafted during US1 UI work. MVP is US1; this slice includes US2.
Fitting and applying weights are explicitly later work, not claimed delivered by these tasks.
T011 is pending: no physical phone attached (adb listed emulator-5554 only). No production deploy
has been made; local validation does not satisfy the installed-phone gate.
