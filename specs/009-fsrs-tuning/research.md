# Research: FSRS tuning

Decision: explicit contextual recall is the measured proxy; Again=0, Hard/Good/Easy=1. Grade the
answer before reveal. Ultimate success is delayed understanding in fresh contexts per effort.
No-tap attentive encounters remain ambiguous; using their generated Goods as labels is circular.

Decision: use exact production replay, including implicit interventions, but score explicit reviews
before their updates. A stock optimizer either drops real interventions or treats guessed outcomes
as truth. Research agent confirmed ts-fsrs 5.4.2 exposes FSRS-6 bounds through clipParameters and
uses whole-day retrievability. Same-day reviews remain transitions but cannot evaluate delayed
retention. A bounded custom optimizer is possible later; not needed for read-only foundation.

Decision: chronological 80/20 split by whole timestamps, log loss/Brier/calibration by skill.
No arbitrary count promises enough data. Later fitting uses only earlier-period labels and freezes
a candidate before evaluating later labels. Repeated candidate selection on holdout overfits it.

Limitations: retrospective current segmentation and session attention, not recorded online
predictions; fixed imported seeds, no Anki review-history fitting. Exclude undated baselines until
a real update, and ambiguous multi-device/backward-clock words. Keep retention preference fixed.

Sources consulted 2026-09-30:
- https://github.com/open-spaced-repetition/srs-benchmark#evaluation
- https://docs.ankiweb.net/deck-options
- https://raw.githubusercontent.com/open-spaced-repetition/py-fsrs/refs/heads/main/fsrs/optimizer.py
- Installed `ts-fsrs` 5.4.2 source (`clipParameters`, FSRS-6, day-based retrievability).
