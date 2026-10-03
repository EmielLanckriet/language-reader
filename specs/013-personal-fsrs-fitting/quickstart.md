# Quickstart: validating spec 013

Synthetic activity only in the isolated setup (`npm run verify:isolated`), never in the daily
reader. Short fixtures (90 s clips, small synthetic histories).

## Story 1 — shown English, taps

1. `npx vitest run tests/domain/evidence.test.ts tests/storage/helped.test.ts` — property test
   (SC-001): helped words never succeed or gain; every tap is a failure; undone taps vanish;
   Known-from-sheet is not a tap. Mutate the helped check and the undo filter; both must go red.
2. `npm run verify:browser -- listened` (fixture service on 18765): reveal a line, finish with
   "every unknown word", export; the revealed line's words have `helped: true`.
3. Word sheet: tap → **Undo tap** → Diagnostics shows `tap-undone`, no lookup.
4. `node scripts/fsrs/evaluate.mjs export.json` reports `card` and `in-context` separately.

## Story 2 — fit on the laptop

1. `npx vitest run tests/domain/fsrs6.test.ts` — own engine equals ts-fsrs `next_state` to 1e-6
   over generated histories; the evidence-3 baseline reproduces production memory exactly.
2. `npx vitest run tests/domain/fit.test.ts` — synthetic history from known parameters: fitted
   later-period log loss ≤ generating set's + 2% (SC-002); a 30-outcome history gives
   "too little data"; same input twice gives identical output.
3. On the reader's real export: `time node scripts/fsrs/fit.mjs export.json --out set.json`
   under 10 minutes (SC-003). Record counts per outcome type in this file.

## Story 3 — apply and roll back

1. `npx vitest run tests/storage/activation.test.ts` — apply then roll back gives memory equal
   field for field (SC-004); a non-applicable or stale set is refused; latest activation wins
   across two devices; backup restore keeps the active set.
2. Isolated phone: import a set, apply, watch the sweep finish; time it (SC-005, < 30 s).

## Story 4 — fit on the phone

1. Measure first: run the fit worker on the A71 over the reader's export size with synthetic data;
   record time and battery temperature. Build the rest only if under 2 minutes (SC-006), else add
   the reverse-mode tape and measure again.
2. Cancel mid-fit and hide the app mid-fit: nothing recorded. Laptop and phone reports on the same
   export agree within rounding.
