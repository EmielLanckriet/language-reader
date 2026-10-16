# Issue #29: which information predicts understanding, which exposures help

Laptop-side, read-only analysis of a learning-data export (format 2) and a library backup
(format 3) of the same library. Keep both, and everything written, outside the repository.

```sh
OUT=/somewhere/outside/the/repo
node scripts/analysis-29/build-rows.mjs reader-fsrs-data.json backup.json $OUT   # ~10 s
node scripts/analysis-29/analyze.mjs $OUT backup.json [WORST=25]                    # ~3 s
node scripts/analysis-29/power.mjs reader-fsrs-data.json $OUT [REPS=200]            # ~3 min
```

- `build-rows.mjs` (step 2): one row per in-context observation (`rows.csv`, `rows.json`), with
  FSRS's prediction from `reviewPredictions` under the export's set in force (as `evaluate.mjs`),
  `p_obs` with the set's label noise, and the attributes the history records: exposures by session
  kind before it and since the last evidence, line and video viewings, speed, creator, time,
  session length, replays, seeks, English shown, frequency, library counts, the line's known-word
  coverage. Also `sessions.csv` (kinds) and `meta.json` (the fit's 80% cutoff). It checks its own
  replay against `reviewPredictions` and prints the mismatches (expect 0).
- `analyze.mjs`: step 1 (`step1.md`), step 3 (`surprise.md`, `worst-for-reader.md`), step 5
  (`step5.md`: one feature at a time, fitted before the cutoff and scored after it, plus a joint
  in-sample model).
- `power.mjs` (step 4): `power.md`. The simulator is `simulate` in `tests/domain/fit.test.ts`,
  extended with an unseen exposure that shifts true recall; draws starting memories, outcomes per
  word and gaps from `rows.json`.

Choices worth knowing:

- The export has no word surfaces or exposure offsets. Exposures and taps are joined to the backup's
  encounters by `deviceSeq`; a word's surface comes from its marks and taps, else it is inferred:
  the substring whose occurrences reproduce exactly the word's exposures (`surface_source`
  `inferred`, or `inferred-uncertain` when ties remain). Such words were never tapped.
- Sessions get one kind from the reader's latest answers: hardcore, withdrawn, listen-only
  ("Only listened"), attentive ("every unknown word"), inattentive ("not tracking", or attentive
  "No"), partial ("Only some", or "Partly"), unanswered. Rewatch = the same video (YouTube id)
  played in an earlier session.
- Same-session line counts (replays, plays, English shown) cover the whole session: a seen outcome
  is timed at the line's first play and a tap later, so "before the outcome" would favour taps.
  They are partly consequences of not understanding, so diagnostics, not predictors.
- Line coverage segments greedily over `static/wordlist-zh.txt` and the library's words, not with
  the app's BERT segmenter (no model is loaded); recall of each other word at that moment.
- Times are Europe/Brussels; weeks Monday to Sunday.
