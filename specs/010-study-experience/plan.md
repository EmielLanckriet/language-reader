# Implementation Plan: Study experience

TypeScript/Svelte/SQLite, existing ts-fsrs and backup formats; no new dependencies.
Append open encounter kinds `study-time` (finite durationMs, max 60 seconds/chunk) and
`session-end`. Activity and explicit endings are earned, weekly totals and pending summaries
derived. Reuse recordEncounters, backup unknown-kind support and attention replay; no migration.

Domain `study.ts` computes weekly credit and summaries. Repository reads sessions/activity/reviews
excluding withdrawals. Worker/client expose overview and existing encounter writes. Recorder emits
bounded duration chunks, controls visible reading time, and closes idempotently. Progress page
provides durable summary/correction UI. Home shows weekly progress and latest continuation.
Library cards/CSS/tab icons share restrained teal/neutral styling; preserve word-state colors.

Constitution: test earned validation/recording/replay first; domain stays framework-free; Anki never
written. Vertical UI→repository→history slice, no new seam. ADR-0034 records facts/reward separation.
No external assets/services. Device validation required before claiming shipped; only emulator
was attached during previous work. Existing dirty work preserved.

Validation: focused tests and mutation checks, type/lint/build, isolated browser end-to-end feedback
and weekly progress with screenshots at mobile width. No synthetic activity in daily reader.
