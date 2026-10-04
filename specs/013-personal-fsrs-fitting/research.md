# Research: Personal FSRS fitting with in-context outcomes

Gathered 2026-10-04 by three read-only research passes and one re-run measurement.

## R1. What the current export and evaluation can carry

Decision: a new export, format 2, built from a derived per-word **item stream** (see
[data-model](data-model.md)) rather than from raw encounters; format 1 stays readable.
Rationale: format 1 (`src/lib/domain/tuning.ts:8-18`) exports only words with reviews, only
`lookup`/`check`/`review` events, and collapses exposures to one row per session without offsets,
so helped spans and untapped-in-unhelped-line cannot be reconstructed. Resolving "helped" needs the
document's line ranges, which live in Reader, so it is resolved there.
Alternatives: exporting raw encounters plus documents (larger, duplicates the resolution logic on
the laptop); widening format 1 (its exact version pins at `tuning.ts:55` would reject old files).

## R2. Where today's rule stops fitting

`evidenceFor` (`src/lib/domain/memory.ts:114-189`) turns every event into a ts-fsrs `Grade`;
`Evidence` has no room for a rule of its own, and `fold` only calls `f.next`. Labels assume
`rating === 1`. Parameters are a fixed 21-weight shape hashed into `ruleKey` (`memory.ts:210`).
Decision: a new replay engine (R4) with typed items and typed outcomes; `evidence-3` (Story 1) is
first expressed in the existing fold, then reproduced exactly by the engine as its baseline.

## R3. Tap and undo

`recorder.opened` only holds the tap in memory; `closed` → `settle` writes `lookup` or `check`
when the sheet closes (`src/lib/ui/recorder.ts:281-377`). Decision: undo while the sheet is open
drops the pending tap and writes a `tap-undone` encounter (kept as a fact: how often taps are
mistaken), never a lookup. Every check counts as a tap under `evidence-3`, including a sheet
closed by choosing **Known** (`knew: 'known'`, `+page.svelte:610`): the reader would not have
tapped a word they knew (2026-10-04). The "I knew it" button is removed and every closed tap is
recorded as a lookup.

## R4. FSRS-6 and the fit

ts-fsrs 5.4.2 ships only `dist/`; formulas at `node_modules/ts-fsrs/dist/index.mjs:680-985`, every
step rounded to 8 decimals, bounds exported as `CLAMP_PARAMETERS` (544-566). No package offers an
optimizer that accepts extra rules: fsrs-rs (and its napi/WASI binding) fits card grades only.
Decision: own unrounded FSRS-6 step functions in the domain core, tested against ts-fsrs
`next_state` to 1e-6, used by both production memory and the fit, so Reader and laptop compute
the same thing. Optimizer: full-batch projected Adam, central finite-difference gradients,
parameters clamped to `CLAMP_PARAMETERS` and the extras' bounds, deterministic (no shuffling).
Rationale: smallest readable code (Principle VII); hand-derived gradients took fsrs-rs ~1,000
lines and would have to be redone for every rule change.
Measured: a plain-JS FSRS-6 replay of 5,000 events over 800 words takes **0.72 ms** on the laptop
(re-run 2026-10-04). With the real rules assume 2-3×: ~62 replays per gradient × 300 iterations
≈ 30-60 s on the laptop. The phone is unmeasured; if it is 5-10× slower SC-006 (2 min) fails, so
Story 4 starts with a phone measurement, and a small reverse-mode tape (checked against finite
differences) is the planned remedy if needed. Not verified: fsrs-rs runtime figures.

Measured 2026-10-04 on a synthetic 13,500-event export: the first `fit.mjs` took 350 s. A replay
cost 7.75 ms, not the benchmark's ~2 ms, because `calendarDays` built two `Date` objects a step
(UTC day numbers are `floor(ms / day)`, so it no longer does: 4.1 ms). With the loss summed during
the replay instead of building rows, each replay stopping at the cutoff, forward differences (27
replays a step instead of 53), and 40-step trial fits for the prior strength with the final fit
continuing from the best: 24.7 s, the same verdict. The tape is not needed unless the phone is
more than ~5× slower than this laptop.

Phone (T035, 2026-10-04): the built fit worker on the Samsung A71, isolated test origin, same
synthetic 13,500-event export: **35 s** (1.4× the laptop), battery 31.9 → 32.1 °C. Same verdict to
1e-10; the fitted numbers differ from the laptop's by at most 4.3e-8 (1.4e-7 relative), so the set
ids differ. No tape needed.

## R5. Priors, split and verdict

Decision: Gaussian prior on the 21 weights centred on the Anki-imported set (defaults if none),
with fsrs-rs's per-weight σ; extras centred on "same as evidence-3", reliabilities on a=0.10,
b=0.05. Prior strength γ chosen from {0.5, 1, 2, 4} on the last fifth of the earlier period
only. One chronological cutoff (80/20 by whole timestamps, as spec 009): fit on outcomes before
it; replay everything with the frozen set and score outcomes after it, each by its
before-application prediction. Verdict: paired per-outcome log-loss differences, bootstrapped by
word (2,000 resamples, fixed seed); "better" only if the 95% interval is below 0 and there are at
least 100 later outcomes of that type; "no worse" for cards if the interval's lower end is below
0 or there are fewer than 100 card outcomes (then cards are not judged).

## R6. Applying, recomputing, backups

Memory rows carry their `ruleKey`; `sweepStaleMemory` (`src/lib/storage/sweep.ts:186-201`)
recomputes stale rows in 200-word transactions while visible, old rows readable meanwhile.
Decision: applying or rolling back appends an `fsrs-activation` encounter; `ruleKey` includes the
active set's id, so the sweep recomputes in the background (Principle VIII). Unknown encounter
kinds round-trip through backups unchanged (`src/lib/backup/format.ts:35-50`). Phone full
rebuild was estimated at ~12 s, never measured (`specs/007-fsrs-flashcards/quickstart.md:54`).
Bug found: `currentParameters` and `recordParameters` (`repository.ts:958`, `:1285`) order by
`device_id` ascending first, so with two devices "latest" is wrong. Fixed in this slice, with a
test, before activation depends on it.

## R7. Phone fitting supervision

ADR-0032's guard is `inferenceBudget` (`src/lib/inference-budget.ts`); supervision (deadline,
terminate when hidden, abort) is written per caller (`src/lib/translation/quick.ts:78-230`).
Decision: Story 4 runs the fit in its own Worker under `inferenceBudget`, terminate on hide,
5-minute deadline, nothing written until a finished fit is shown. No shared helper is extracted
for one more caller.

## R8. Helped spans

Decision: per session, a word occurrence is helped if a `translation` encounter's range covers it
(older reveals: the line index mapped to that line's range in the document), or if English was
shown for the whole screen at any moment of the session: stage view with blur off (from the
opening note or a toggle) or show-all English. The whole-session rule is deliberately cautious;
per-moment intervals are not worth their complexity while exposures are grouped per session.
Older sessions without an opening note count as blurred (clarification 2026-10-04).

Sources: fsrs-rs `src/training_v6.rs`, `src/parameter_initialization.rs`,
https://github.com/open-spaced-repetition/fsrs-rs; installed ts-fsrs 5.4.2 `dist/index.mjs`;
spec 009 research.
