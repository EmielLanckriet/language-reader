# Working rules

Short on purpose: this file is read every session, so length here is a tax on every session.

The constitution (`.specify/memory/constitution.md`) says what this project *is*. This says how to
work in it without spending more than the work is worth. Everything below came from a session that
cost far more than it should have, and the diagnosis is in the last section.

## The irreversible surface, which is small

Full discipline — test-first, exact assertions, transactions, an ADR when a door closes:

- `Repository.assertState`, `appendEvent`, `writeProjectedState` — the reader's judgments
- `src/lib/storage/migrations/` — one-way by definition
- anything that deletes a `lexeme` — marks point at them
- segmentation *correctness* properties (tiling, offsets, coverage, unit-locality)

Everything else — tokens, segmentation output, caches, the model, every screen, the sweep, the
service worker — is derived and recomputable on purpose (ADR-0003). Breaking it costs a re-derive,
not a loss. **Move fast there.**

## Principle II's list is a ceiling, not just a floor

It names the areas that MUST be tested first, and says wiring and glue are EXEMPT. Honour both
halves. Orchestration gets **one test that would catch a plumbing bug**, not a suite. A recent
change shipped 860 test lines for 400 lines of logic; maybe a third of that was mandated.

## Before keeping a test, make it fail

Mutate the code it covers and watch it go red. Three tests written in one session could not fail at
all — two equivalence properties that were true by construction, and a property whose generator
skipped nearly every case. A test that cannot fail is worse than no test, because it reads as
coverage. This habit *reduces* the number of tests worth writing.

## Measure before asserting, not after

Two confident hypotheses in one slice — "batching will fix SC-004", "the progress callback causes
the hang" — were both wrong under measurement, and cost more than all process combined. State a
suspicion as a suspicion; spend the ten minutes to measure it before it goes in a commit message or
an ADR. `scripts/measure/` is where the one-off harnesses live when they are worth keeping.

## What is actually slow here

Not writing code. Verifying in a browser (a build, a Chrome, minutes of waiting) and round-trips to
the phone (a deploy, an update prompt, a wait on a person).

- Run only the `verify:browser` scenarios a change can plausibly reach.
- Batch phone checks: three or four changes per deploy, not one.
- Reading this codebase is expensive too — `src/` is about a third comment lines. Write comments for
  *decisions*, and let mechanical code be read as code.
