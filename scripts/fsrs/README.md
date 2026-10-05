# FSRS candidate evaluation

In Reader, open **More → Cards → Learning data → Export learning data**. On a laptop with this checkout's
dependencies installed and Node 24:

```sh
node scripts/fsrs/evaluate.mjs /path/to/reader-fsrs-data.json > /tmp/fsrs-report.json
node scripts/fsrs/evaluate.mjs /path/to/reader-fsrs-data.json /path/to/candidate.json
```

Candidate format: `{"weights": [21 finite FSRS-6 weights]}`. Use a real 21-element array;
out-of-range values are rejected. Retention stays at the exported preference. Nothing is uploaded,
fitted, applied to Reader or written to Anki. Keep personal exports outside the repository.

Exports are format 2 (spec 013): words with a review, a tap, or a reading in a session answered
"every unknown word", and exposures marked `helped` when English was shown over them. Format 1
files still load and replay under the current rule.

Two kinds of outcome are scored and reported apart. Card grades: Again=0, Hard/Good/Easy=1. Reading
in context: a tap is 0; an untapped word read with no English shown in a session answered "every
unknown word" is 1. Listening has no in-context outcome yet.

## Fitting (spec 013)

```sh
node scripts/fsrs/fit.mjs /path/to/reader-fsrs-data.json --out /tmp/fitted-set.json
```

Fits the 21 FSRS-6 weights, how strongly a tap and an untapped reading count, and how noisy
in-context observations are, on the earliest 80% of scored outcomes only, pulled towards your
Anki weights and today's rule. It then scores the fitted set beside the one in force on the latest
20% and says whether Reader may apply it: only when reading in context is predicted better (the
95% bootstrap interval below zero, at least 100 later outcomes) and card answers no worse. A real
difference of a few hundredths per outcome needs several hundred later outcomes to show.
Deterministic: the same export gives the same set. Measured 2026-10-04: 5 min 50 s for a
synthetic 13,500-event export on the laptop.

Card grades contribute labels: Again=0, Hard/Good/Easy=1. The full evidence-2 transition
history still updates state, including attentive encounters. First/undated/less-than-24h reviews
cannot score delayed retention; they remain in replay. Ambiguous device-clock words are excluded.

The earliest 80% of eligible observations is the development period, the latest 20% the later
evaluation period (whole timestamp groups, so counts can differ). Later reviews update subsequent
states, but never their own predictions. Lower log loss/Brier is better; also compare predicted
versus observed recall by skill. Empty scores are null. Very small or all-success samples do not
establish whether personalization works.

This is a retrospective snapshot under current segmentation, current session attention and fixed
Anki seeds; it does not reconstruct predictions actually displayed at the time. Repeatedly trying
candidates against the same later period makes it development data. A future optimizer should fit
only earlier labels, freeze its candidate, then evaluate on fresh later data. A stock FSRS optimizer
cannot consume Reader's inferred grades as measured outcomes without changing the objective.

This foundation intentionally does not fit or apply weights. The next slice needs a bounded
optimizer for the mixed history and an earned, reversible apply/rollback contract. No heavy
optimization belongs on the phone.
