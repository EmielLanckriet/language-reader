# Data model

All new objects are derived. No migration, earned writes or parameter activation.

- Dataset: format 1, evidence rule, scheduler version, export date, active parameters, reviewed
  words with opaque local id and WordHistory; serialize attention Map as tuples. No text/media.
- Evidence: optional explicit-review identity (deviceId/deviceSeq), never on inferred ratings.
- Observation: identity, skill, timestamp, rating, pre-update probability or exclusion reason.
  Exclusions: no prior memory, undated seed, less than 24h after update, ambiguous clock.
- Report: explicit/eligible/excluded counts, chronological periods, n/successes/observed recall,
  predicted recall/log loss/Brier, separately by skill. Missing metrics are null.

Ignored words and withdrawn sessions are excluded by the current rule/query. Dataset is a
retrospective snapshot, not a backup or historical prediction log. Raw source stays in backups.
