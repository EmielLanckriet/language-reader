# Data model

Earned encounters: `study-time` with detail.durationMs in (0,60000], at=end of chunk;
`session-end` with no extra fields. Attention remains all/some/none/null, latest in history wins.
Existing session document/modality/start and event order retained. Backup/restore preserves open kinds.

Derived StudySession: id/document/title/modality/start/last/activityMs/answer/answered/ended.
Derived Week: seven local date keys, seconds and review counts; qualified if >=60000ms or >=5
reviews. Withdrawn sessions removed first. Legacy sessions can appear for feedback when played
duration >=30s or explicit activity/end exists; legacy reading duration cannot be recovered.
