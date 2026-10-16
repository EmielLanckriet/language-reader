# Tasks: Find videos by due and new words

**Input**: [plan.md](plan.md), [spec.md](spec.md), [contracts/service.md](contracts/service.md)

## Phase 1: Scoring an unsaved text (US1 core)

- [x] T001 Test first, `tests/content/find.test.ts`: for random small libraries (marks, memory,
      encounters) and a candidate text, `scoreText` equals the figures the library gives the same
      text saved as a document: known share, due words (as a set, equal to `wordCounts.due`), and
      never-met count against the reference definition. Watch it fail.
- [x] T002 `src/lib/domain/shares.ts`: `dueWords(...)`, the due predicate `wordCounts` uses, and
      `wordCounts` built on it.
- [x] T003 `src/lib/storage/repository.ts`: `wordsByForm(language, forms)` read-only, returning
      lexeme id and `met` per form; worker, protocol and client plumbing.
- [x] T004 `src/lib/content/find.ts`: `scoreText(text, analyzer)` (resolve, count by key, look up,
      placeholders for unknown keys, then the domain functions). T001 passes; mutation-check.

## Phase 2: The service (US1, US2)

- [x] T005 `scripts/termux/test_service.py`: `/search`, `/subtitles` (human first, automatic only
      without human Chinese, no translations, 429 → rate-limited), `/download` (address check,
      opener started), with yt-dlp replaced by a stub via `READER_YTDLP`. Watch them fail.
- [x] T006 `scripts/termux/reader-service.py`: the three endpoints, one yt-dlp at a time.

## Phase 3: The page (US1, US2, US3)

- [x] T007 `src/lib/content/find.ts`: `search`, `subtitlesOf` (track choice with
      `classifyTracks`/`defaultChoice`, `parseSubtitles`), `download`, ordering and grouping by
      the bar.
- [x] T008 `src/routes/find/+page.svelte`: query box, recent queries, bar, streamed results in
      three groups, Download / In the library / Downloading, retry for rate-limited ones, the
      Start Termux offer when the service is not running; a link from the library.
- [x] T009 Browser scenario `findvideos` with a stub yt-dlp (quickstart §2).

## Phase 4: Ship

- [x] T010 Lint, type check, all tests; deploy; update the phone's reader-service.py; phone check
      (quickstart §3); docs (current-state, backlog, issue #11).
