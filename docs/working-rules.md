# Working rules

Short on purpose: this file is read every session, so length here is a tax on every session.

The constitution (`.specify/memory/constitution.md`) says what this project _is_. This says how to
work in it without spending more than the work is worth. Start with `docs/current-state.md` for the maintained project status.

## The irreversible surface, which is small

Full discipline — test-first, exact assertions, transactions, an ADR when a door closes:

- `Repository.assertState`, `appendEvent`, `writeProjectedState` — the reader's judgments
- `src/lib/storage/migrations/` — one-way by definition
- anything that deletes a `lexeme` — marks point at them
- segmentation _correctness_ properties (tiling, offsets, coverage, unit-locality)

Derived data can be rebuilt from retained inputs (ADR-0003), which makes structural changes easier.
Wrong transcripts, segmentation, and UI behavior still cost learning time: verify relevant behavior
and recovery. Earned history must never be overwritten by a background improvement.

## Principle II's list is a ceiling, not just a floor

It names the areas that MUST be tested first, and says wiring and glue are EXEMPT. Honour both
halves. Orchestration gets **one test that would catch a plumbing bug**, not a suite. A recent
change shipped 860 test lines for 400 lines of logic; maybe a third of that was mandated.

## Before keeping a test, make it fail

Mutate the code it covers and watch it go red. Three tests written in one session could not fail at
all — two equivalence properties that were true by construction, and a property whose generator
skipped nearly every case. A test that cannot fail is worse than no test, because it reads as
coverage. This habit _reduces_ the number of tests worth writing.

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
  _decisions_, and let mechanical code be read as code.

## Planning proportional to the change

Use the full Spec Kit flow for substantial features, earned-data contracts, and architectural
changes. Small fixes, UI adjustments, documentation, and reversible implementation changes need
only a clear problem, a focused change, and relevant checks (ADR-0031). Keep an ADR when a lasting
tradeoff changes. Reuse the segmenter comparison harness for quality measurements; invariant tests
and quality benchmarks answer different questions.

## Verification and device use

- Use isolated verification for synthetic interactions: separate browser origin **and** service
  data. See `scripts/verify-in-browser/README.md`. Another path or test document is not isolation.
- Use 60–90 second media fixtures; full-length runs are for an explicitly needed measurement.
- Before every adb input, check the foreground app immediately. If the user has switched apps,
  pause device work instead of taking the phone back. Never enter a PIN.
- Keep the phone awake over USB during checks; restore the previous setting afterward.
- Reuse browser targets and poll observable conditions with deadlines. Stop only owned PIDs.
- Do not assume a successful local check proves installed-phone behavior. Report the distinction.
- Compare alternatives fairly, including costs shared by both. Measure claims before recording
  them as facts. Keep comments about decisions, not a narration of mechanical code.
