# Evaluation contract

Cards → Learning data opens a read-only report explaining grading before Show, counting explicit
and delayed reviews by skill and downloading `reader-fsrs-data.json` locally.

`node scripts/fsrs/evaluate.mjs DATASET [CANDIDATE]` prints JSON to stdout; errors to stderr with
nonzero exit. Candidate: `{ "weights": [21 finite FSRS-6 values] }`. Reject out-of-bound weights
rather than silently clipping. Retention stays fixed. Dataset format/rule/scheduler must match.

Same timestamp groups share a period. First/undated/same-day observations are excluded from
scores but retained as transitions. Ambiguous device clocks exclude whole words. Candidate
scores are exploratory, not authorization to apply. Export reflects retrospective session
attention/segmentation. Seeded rows are counted as a limitation.
