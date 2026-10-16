# Implementation Plan: Find videos by due and new words

**Branch**: `015-find-videos` (on main) | **Date**: 2026-10-16 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/015-find-videos/spec.md`. A light plan, proportional
to the change (ADR-0031): no earned data, no migration, nothing written to the reader's history.

## Summary

A Find videos page searches YouTube through the Termux reader service (three new endpoints: search,
one video's Chinese subtitles, start a download) and scores each candidate in Reader with the
library's own code on an **unsaved** text: segmented by the analyzer in force, its words looked up
read-only by written form, then `textShares`, a due-word list taken from `wordCounts`' rule, and
never-met words from `ENCOUNTERED_WORDS`. Results stream in as each candidate is scored.

## Technical Context

**Language/Version**: TypeScript (SvelteKit app); Python 3 (Termux reader service)

**Primary Dependencies**: existing only: yt-dlp in Termux (with `--js-runtimes node`), the app's
analyzer (`analyzer/active.ts`), `media/subtitles.ts` (`classifyTracks`, `defaultChoice`,
`parseSubtitles`), `domain/shares.ts`. No new dependency.

**Storage**: none new. Reads states, memory and met words through the storage worker; the bar and
recent queries in `localStorage` (per-device conveniences, as `reader.stage` is).

**Testing**: vitest for the scoring (property: an unsaved text scores as the same text saved as a
document does) and the service endpoints (`scripts/termux/test_service.py`, yt-dlp stubbed); one
browser scenario against the disposable service with canned results.

**Target Platform**: the installed Reader on the reader's Android phone, with Termux.

**Project Type**: offline-first web app plus its local Termux service.

**Performance Goals**: first scored result within 60 s on the phone; 15 results within 8 min
(spec SC-001). Scoring one candidate is one analyzer pass over its subtitle text plus three
read-only storage calls.

**Constraints**: no history writes (FR-012); Reader never contacts YouTube itself (no server,
ADR-0007); polite to YouTube (one yt-dlp at a time, pauses, 429 reported not retried).

**Scale/Scope**: one page, three service endpoints, one scoring module, ~600 lines with tests.

## Constitution Check

| Principle | How this plan meets it |
| --- | --- |
| I. Every slice ships to the phone | Deployed and checked on the phone (quickstart §3). |
| II. Test-first on state transitions | No state transition: nothing earned is written. The scoring equivalence (unsaved = saved) is tested first, with a mutation check. |
| III. Anki read, never written | Untouched. |
| IV. Vertical slices | Search → score → download in one slice. |
| V. Modular by seam | Scoring in `src/lib/content/find.ts` over domain functions; the service talks yt-dlp; the page only shows. |
| VI. Decisions recorded | research.md here; no ADR, since no lasting tradeoff changes. |
| VII. Readable over clever | Reuses the library's functions rather than parallel ones. |
| VIII. Fast first | Results stream per candidate; the search list appears before any subtitles. |

No violations; no complexity tracking needed.

## Project Structure

### Documentation (this feature)

```text
specs/015-find-videos/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/service.md
├── quickstart.md
└── tasks.md
```

### Source Code (repository root)

```text
scripts/termux/reader-service.py      # GET /search, GET /subtitles, POST /download
scripts/termux/test_service.py        # their tests, yt-dlp stubbed
src/lib/domain/shares.ts              # dueWords(), shared with wordCounts
src/lib/storage/repository.ts         # wordsByForm(): read-only lookup by written form, met flags
src/lib/storage/{client,worker,protocol}.ts
src/lib/content/find.ts               # service calls, track choice, scoring an unsaved text
src/routes/find/+page.svelte          # the page
src/lib/ui/Library.svelte             # a link to it
tests/content/find.test.ts            # unsaved text scores as the saved document does
scripts/verify-in-browser/harness.mjs # scenario `findvideos`
```

**Structure Decision**: the existing single SvelteKit app plus the Termux service, as every recent
feature.
