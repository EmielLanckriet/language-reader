# Research and decisions

Existing attention prompt is an in-memory Recorder pointer triggered by component cleanup after
30 seconds. Pause/hide only flush; no durable unanswered queue. Replace modal with history-derived
summaries and explicit Finish, keeping optional attention answers append-only.

Record measured time in small chunks, not a running total, so backup/replay and withdrawals work
through existing contracts. Visibility and an idle cap bound reading estimates; media uses continuous
position differences/speed. All answers earn equal review participation credit. Current timezone
defines calendar week; this is visible behavior, not a claim to preserve travel-local historical dates.

Reward choice follows the previously researched streak evidence (spec discussion): low starting
barrier, retained progress, no incentive to misreport success or attention. Five days and one minute
are product defaults, not scientifically optimal thresholds. No new technical dependency needed.
