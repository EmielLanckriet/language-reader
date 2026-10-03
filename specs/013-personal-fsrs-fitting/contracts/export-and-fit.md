# Contract: learning-data export v2 and the fit command

## Export (Cards → Learning data → Export)

```json
{
  "format": 2,
  "rule": "evidence-3",
  "exportedAt": "ISO time",
  "active": { "id": "set id", "set": "ParameterSet | null (Anki/defaults)" },
  "anki": { "weights": [21], "retention": 0.9 },
  "words": [{ "id": 1, "items": [ { "kind": "review|tap|seen", "at": "ISO", "deviceId": "…",
      "deviceSeq": 1, "sessionId": 3, "skill": "reading|listening", "grade": 3,
      "answer": "all|some|none|null", "helped": false, "textVisible": true } ], "seed": {} }]
}
```

Words with any review, tap or seen item are included; withdrawn sessions are excluded; format 1
files remain readable by `evaluate.mjs`. No text, no document titles: only ids and times.

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
