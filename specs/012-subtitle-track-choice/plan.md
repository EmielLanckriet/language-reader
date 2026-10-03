# Plan: Subtitle track choice at import

**Spec**: [spec.md](spec.md) · **Date**: 2026-10-03 · **Branch**: main

## Summary
Termux downloads every human subtitle track (and automatic Chinese only when there is no human
Chinese), names them `track.<lang>.vtt` / `track-auto.<lang>.vtt` and describes them in
`tracks.json`. On Open, Reader classifies the tracks by content; when there are several clean
Chinese tracks or a human English track it shows a bottom sheet with previews and preselected
defaults, otherwise it imports directly. The chosen Chinese track becomes the document text as today;
the chosen English track is aligned to it by time and shown as human English, ahead of the LLM and
quick-model lines. Reader reports an asked choice to Termux, which only then translates, and only
the uncovered lines. Research: [research.md](research.md).

## Technical context
- TypeScript + Svelte PWA (existing), Python 3 Termux scripts, bash `termux-url-opener`, yt-dlp.
- Storage: OPFS document folders (ADR-0018) and Termux job folders; no SQLite migration.
- No new dependency. Reuses `chooseChineseTrack` (f784e37), translate.py's twin (a7a6b86), the
  StateMenu bottom-sheet pattern, `englishFor`/`llmByLine`, the reader-service static file serving.
- Testing: vitest (`tests/media`, `tests/translation`), Python unittest (`scripts/termux`), the
  isolated `verify:browser` harness, one batched phone check.
- Constraints: no extra automatic-caption requests (HTTP 429); no phone translation before an asked
  choice (FR-011); thermal limits of ADR-0032 unchanged.

## Constitution check
- **I. Ships to the phone**: quickstart phone checks 1–3, one deploy, app before Termux (R5).
- **II. Test-first**: none of the mandatory areas changes (no status, merge/split, replay,
  scheduling, segmentation, Anki export). Derived outputs are tested on properties (R3); the choice
  rule on a shared fixture table; one test per plumbing path (choice PUT, translate start/no-start).
- **III. Anki never written**: untouched.
- **IV. Vertical slices**: US1 is already shipped; US2+US3 ship together as one slice (the choice is
  only useful with English tracks downloaded); US4 is a small follow-on in the same feature.
- **V. Seams traced to anticipated changes**: retaining every track (FR-008) traces to "use a pinyin
  track's readings" and "split a Chinese+English track"; recording `lang` traces to "other
  languages". No per-channel preference seam is built.
- **VI. Decisions recorded**: ADR-0036 "Subtitle tracks are kept and chosen at import" (track
  naming, choice protocol, deployment order).
- **VII. Readable over clever**: two small pure functions (classify/choose, align) plus glue.
- **VIII. Fast first**: no-choice imports start translating as early as today; human English is the
  best result and is never replaced by LLM or quick lines; each line records its source.
- **Earned data**: the Chinese text is fixed at import (FR-005); English is derived (`english.json`).

Gate: passes; no violations to justify.

## Project structure
```text
scripts/termux/termux-url-opener     two-pass subtitles, tracks.json, translate only when no choice
scripts/termux/reader-service.py     PUT /downloads/<job>/choice.json
scripts/termux/translate.py          source from choice.json; uncovered lines only; choice rule
scripts/termux/test_*.py             shared-fixture rule, choice PUT, start/no-start
src/lib/media/subtitles.ts           classifyTracks, defaultChoice, choiceNeeded (from chooseChineseTrack)
src/lib/media/import.ts              planImport(bundle) → tracks/defaults/needed; importBundle(bundle, title, choice)
src/lib/media/store.ts               isSubtitle excludes track*; english.json; keep tracks.json + tracks
src/lib/media/termux.ts              report choice to the service
src/lib/translation/lines.ts         humanByLine (R3), englishFor with 'human'
src/lib/ui/TrackChoice.svelte        bottom sheet (StateMenu pattern), previews, defaults
src/routes/+page.svelte              openJob: plan → sheet when needed → import → report
src/routes/read/[id]/+page.svelte    English source switch (US4); human lines; no Termux follow when 'none'
tests/fixtures/track-choice-cases.json  shared table for both languages
tests/media/*, tests/translation/*   choice rule, alignment properties, englishFor order
scripts/verify-in-browser/           new fixtures + scenarios (quickstart.md)
docs/adr/0036-subtitle-tracks-chosen-at-import.md
```

## Implementation order
1. Shared fixture table and the TS/Python choice rule (tests first, both languages).
2. Termux: two-pass download, `tracks.json`, conditional translate start, `choice.json` endpoint,
   translate.py source/uncovered lines.
3. App: `planImport`, `isSubtitle` change, keep tracks, `TrackChoice` sheet, report choice.
4. Human English: `humanByLine`, `englishFor` order, read-page display with source marking.
5. US4 English switch.
6. Fixtures, browser scenarios, ADR-0036, docs/current-state.md; deploy app, then Termux; phone check.

## Risks
- A video with a human English track is needed for the phone check (quickstart, phone check 2).
- YouTube may serve several human tracks under one language code; yt-dlp keys by code, so only one
  would arrive (R1 open item). Acceptable: it is today's behaviour per code.
- Termux newer than the app would wait forever for a choice; mitigated by deploying the app first.

## Complexity tracking
None.
