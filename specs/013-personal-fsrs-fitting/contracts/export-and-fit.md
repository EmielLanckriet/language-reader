# Contract: learning-data export v2 and the fit command

## Export (Cards → Learning data → Export)

Format 2 is format 1's shape (`src/lib/domain/tuning.ts`) with three changes, chosen during
implementation as smaller than a separate item stream: `format: 2`, `rule: 'evidence-3'`; each
exposure carries `helped` (resolved in Reader, which has the line ranges); and words are included
when they have a review, a tap (lookup or check), or a reading in a session answered "every
unknown word". Withdrawn sessions are excluded. No text or titles: only ids and times. Format 1
files remain readable and replay under the current rule. Fitted parameters (Story 2) will add an
`active` set and the Anki weights.

## `node scripts/fsrs/fit.mjs <export.json> [--out set.json]`

- Validates the export; refuses a different `rule` or engine version.
- Splits at the 80% timestamp; chooses γ inside the earlier period; fits on earlier outcomes.
- Prints a report to stdout and writes the fitted `ParameterSet` (data-model) to `--out`.
- Report, per outcome type (`card`, `in-context`) and skill, for the fitted set, the export's
  active set and the Anki/evidence-3 baseline: count, observed rate, mean prediction, log loss,
  Brier, calibration in 5 bins, paired-difference 95% interval, verdict.
- Verdict values: `better`, `not better`, `too little data`. The set is `applicable` only under
  FR-012.
- Exit 0 whether or not applicable; nonzero only on invalid input.

`evaluate.mjs` stays for comparing a hand-made candidate; it accepts format 1 and 2.
