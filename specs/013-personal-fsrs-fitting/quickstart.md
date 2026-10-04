# Quickstart: validating spec 013

Synthetic activity only in the isolated setup (`npm run verify:isolated`), never in the daily
reader. Short fixtures (90 s clips, small synthetic histories).

## Story 1 — shown English, taps

1. `npx vitest run tests/domain/evidence.test.ts tests/storage/helped.test.ts` — property test
   (SC-001): helped words never succeed or gain; every tap is a failure; undone taps vanish;
   a tap closed by choosing Known is still a tap; a tap under shown English is still a failure.
   Mutate the helped check and the undo filter; both must go red.
2. `npm run verify:browser -- listened` (fixture service on 18765): reveal a line, finish with
   "every unknown word", export; the revealed line's words have `helped: true`.
3. Word sheet: tap → **Undo tap** → Diagnostics shows `tap-undone`, no lookup.
4. `node scripts/fsrs/evaluate.mjs export.json` reports `card` and `in-context` separately.

Recorded 2026-10-04: 497 tests, type check and lint pass. Mutations caught: removing the helped
skip in `evidenceFor` (2 tests red), forcing every exposure unhelped in `wordHistory` (storage test
red), typing every prediction as `card` (4 tuning tests red), and the parameter ordering fix
(two-device test red before it). Browser: `listened` and `encounters` pass on a verification build;
`encounters` needed three repairs from specs 010–011 (Cancel by label, the attention question on
Progress, the sheet's memory line).

## Story 2 — fit on the laptop

1. `npx vitest run tests/domain/fsrs6.test.ts` — own engine equals ts-fsrs `next_state` to 1e-6
   over generated histories; the evidence-3 baseline reproduces production memory exactly.
2. `npx vitest run tests/domain/fit.test.ts` — synthetic history from known parameters: fitted
   later-period log loss ≤ generating set's + 2% (SC-002); a 30-outcome history gives
   "too little data"; same input twice gives identical output.
3. On the reader's real export: `time node scripts/fsrs/fit.mjs export.json --out set.json`
   under 10 minutes (SC-003). Record counts per outcome type in this file.

Recorded 2026-10-04: own FSRS-6 equals ts-fsrs to 1e-6 (mutation of the same-day rule caught);
the fast replay equals Reader's predictions for any history, rule strengths and Anki seed
(mutations of the strengths, the prediction's day count and undated seeds caught). Fit tests:
SC-002 met on 150 synthetic words (shrunk after CI, slower, timed out at 250); deterministic; unaffected by later outcomes (mutation: fitting
on all outcomes, caught); noise model pinned (mutation caught after adding a direct test);
optimizer that never steps caught. The fit code was written before its tests, so each test was
shown able to fail by mutation instead. Verdict power: at 340 later in-context outcomes a true
0.037/outcome improvement was "not better" (interval −0.080 to +0.002); 1,000 words found it.
Production replay through ts-fsrs costs 75 ms per 4,800 events (cached scheduler 73 ms) against
0.7 ms for the own engine: the reason for fsrs6.ts. `fit.mjs` on a synthetic 13,500-event export:
350 s on the laptop (SC-003 met); the phone would need the faster gradient of research R4.
The reader's real export has not been fitted yet (it is on the phone).

## Story 3 — apply and roll back

1. `npx vitest run tests/storage/activation.test.ts` — apply then roll back gives memory equal
   field for field (SC-004); a non-applicable or stale set is refused; latest activation wins
   across two devices; backup restore keeps the active set.
2. Isolated phone: import a set, apply, watch the sweep finish; time it (SC-005, < 30 s).

Recorded 2026-10-04: activation tests (apply → return gives memory equal field for field; refusals;
latest by time across devices; restore keeps the set) with mutations caught: device-first
ordering (after fixing the test's own device id, which let it pass by luck), and skipping the
"fitted against the set in force" check. A neutral-strength property test (every strength 1 =
today's memory, due dates included) caught a last-bit floating-point difference, fixed by
returning FSRS's own step at strength 1. The `parameters` browser scenario caught a real bug: the
imported set, a Svelte state proxy, could not be posted to the storage worker. SC-005 (recompute
on the phone under 30 s) is not measured: no phone connected.

Phone, 2026-10-04 (isolated origin, A71, 2,000 synthetic Anki words imported in 5.2 s): apply
recomputed 2,008 word rows in 2.1 s, return in 2.3 s (SC-005 met); 411 px, no overflow. The first
attempt never finished: the memory sweep's catch-up query listed words that evidence-3 gives no
memory (read only under shown English), so the sweep refreshed them forever while the page was
visible, at every start. Fixed in `9152cbb` with a storage test and a sweep test written first;
Apply/Return now also recompute at once instead of at the next start.

## Story 4 — fit on the phone

1. Measure first: run the fit worker on the A71 over the reader's export size with synthetic data;
   record time and battery temperature. Build the rest only if under 2 minutes (SC-006), else add
   the reverse-mode tape and measure again.
2. Cancel mid-fit and hide the app mid-fit: nothing recorded. Laptop and phone reports on the same
   export agree within rounding.

Recorded 2026-10-04: 35 s on the A71 for 13,500 synthetic events (SC-006 met), 31.9 → 32.1 °C;
parameters within 4.3e-8 of the laptop's. Cancel was checked in the browser (`fithere`), not on
the phone: a fresh test profile has no history, so the fit there ends before it can be cancelled
or hidden. The deadline and the hide rule are therefore unexercised on the phone.
