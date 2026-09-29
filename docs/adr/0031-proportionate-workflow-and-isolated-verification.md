# ADR-0031: Proportionate Planning And Isolated Verification

**Status**: Accepted
**Date**: 2026-09-29
**Relates to**: Constitution II and Development Workflow; ADR-0030

## Context

The user approved simplifying the workflow, reconciling the handoff, isolating automated phone
checks, and strengthening recovery. Older project notes disagree about what is built. Automated
checks in the daily reader have already contaminated learning history (ADR-0030).

## Decision

- `docs/current-state.md` is the maintained entry point for status and open work. Specifications
  and ADRs retain their historical context; code and measurements establish actual behavior.
- Use the full Spec Kit flow for new capabilities, changes to earned-data contracts, or substantial
  architectural changes. Small fixes, documentation, UI adjustments, and reversible implementation
  changes use a short problem statement, focused changes, and relevant verification. Clarification
  remains mandatory in the full flow; it need not block an unambiguous small fix.
- Keep invariant tests for segmentation. Allow separate, versioned quality benchmarks on a small
  reviewed corpus; disagreement with a reference segmentation is a quality measurement, not proof
  that the analyzer broke a universal invariant. Existing comparison tooling is reused.
- Automated interaction uses a separate browser origin and a separate reader service with a
  disposable root. Merely using another document or URL path does not isolate SQLite, backups,
  or reading history. The verification build visibly identifies itself and cannot start the real
  Termux helper. Daily-reader checks are limited to installation/update behavior that requires it,
  without synthetic learning interactions.

## Alternatives Rejected

- A recording-off toggle: misses manual marks, reviews, corrections, and external backup writes.
- Withdrawing every synthetic session afterward: recovery is useful, but cleanup can be interrupted.
- Rewriting old specifications as current documentation: erases decision history and multiplies
  maintenance work.
- Universal planning gates or a broad refactor: neither addresses these concrete failures.

## Consequences

Verification has its own data and service lifecycle. It does not prove installation or persistence
on the production origin; those checks remain separately reported. Earned-data test-first rules
remain unchanged. Recovery fixes need regression checks that exercise actual failure paths.
