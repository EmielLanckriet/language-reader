# FSRS candidate evaluation

In Reader, open **Cards → Learning data → Export learning data**. On a laptop with this checkout's
dependencies installed and Node 24:

```sh
node scripts/fsrs/evaluate.mjs /path/to/reader-fsrs-data.json > /tmp/fsrs-report.json
node scripts/fsrs/evaluate.mjs /path/to/reader-fsrs-data.json /path/to/candidate.json
```

Candidate format: `{"weights": [21 finite FSRS-6 weights]}`. Use a real 21-element array;
out-of-range values are rejected. Retention stays at the exported preference. Nothing is uploaded,
fitted, applied to Reader or written to Anki. Keep personal exports outside the repository.

Only explicit grades contribute labels: Again=0, Hard/Good/Easy=1. The full evidence-2 transition
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
