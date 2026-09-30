# ADR-0034: Durable session feedback and participation rewards

**Status**: Accepted
**Date**: 2026-09-30

Replace the ephemeral attention modal with history-derived session summaries and explicit Finish.
Retain optional, editable attention answers as append-only events. Record bounded activity duration
chunks and session endings in the existing open encounter log; derive weekly credit, never store
mutable reward counters. Backups and withdrawals therefore keep the same source of truth.

One minute of tracked activity or five card answers qualifies a day; goal five days per local
Monday–Sunday week. All grades and attention answers receive equal treatment. No claim that timer
activity measures focus. Visibility/idle limits prevent obvious background inflation. Older reading
time is not invented. Daily streak penalties and points are deferred.

Rejected: persisting a modal pointer, focus-based points, inferred success-based rewards and
separate mutable streak tables. They lose interruptions, bias learning evidence, or duplicate history.
