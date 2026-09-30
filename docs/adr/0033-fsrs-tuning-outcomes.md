# ADR-0033: Score explicit recall, retain implicit interventions

**Status**: Accepted for read-only foundation
**Date**: 2026-09-30
**Relates to**: ADR-0027, spec 009

## Decision

Score explicit recall before applying its grade: Again=failure; Hard/Good/Easy=reported success.
Attentive exposures, checks and lookups remain evidence-2 interventions, never measured labels.
Ultimate success is delayed understanding in fresh contexts per effort; flashcards are a proxy.
Reuse the production fold, chronological evaluation and per-skill scores. Export/evaluate locally
on demand. No optimizer/parameter activation on the phone. Fit/apply follow separately.

## Alternatives and consequences

Implicit Goods as labels validate our assumptions. A review-only stock optimizer omits production
interventions. Maximizing Good presses rewards easier cards/shorter intervals. Automatic fitting
on tiny data can look personalized without predicting better.

Retrospective attention/segmentation and imported seeds limit interpretation. Raw history and
the user's evidence-2 preference remain unchanged. Future in-context probes need a defined prompt
and assistance protocol before collection. Retention is a user preference, not a fitted weight.
