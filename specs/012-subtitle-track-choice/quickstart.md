# Quickstart: validating spec 012

## Laptop checks
1. `npx vitest run tests/media tests/translation` — track classification and default choice
   against `tests/fixtures/track-choice-cases.json`; R3 alignment properties (every English cue
   shown exactly once, order kept, identical timings one-to-one); `englishFor` never replaces a
   human line.
2. `python3 -m unittest discover scripts/termux` — the same fixture table through translate.py's
   rule; `PUT choice.json` validation and translate.py start/no-start in `test_service.py`
   (with `TRANSLATE_STUB=1`).
3. Fixture bundles from `scripts/verify-in-browser/make-fixtures.sh`, added for this feature:
   `fixture-tracks-clean-mixed` (Jun's shape: one clean, one pinyin), `fixture-tracks-english`
   (clean Chinese + human English with shifted timings), and the existing pre-012 `fixture-media`.
4. `verify:browser` scenarios, isolated origin and service data (docs/working-rules.md):
   - clean+mixed imports without a choice, text equals the clean track (US1, SC-1/SC-2);
   - English fixture shows the choice with defaults preselected; confirming imports; human lines
     show as human, the uncovered line stays empty, Termux translates nothing; the sheet fits 390 px (US2/US3);
   - leaving the choice imports nothing and the job stays listed (US2);
   - switching English on the read page leaves marks and encounters untouched (US4, SC-4);
   - pre-012 fixture imports exactly as before (FR-009).

## Phone checks (Principle I), batched in one deploy
App deployed first, then `update-translation.sh` and the new `termux-url-opener` (R5 order).
Do not run heavy translation benchmarks while thermal validation is open; one real import each:
1. Share Jun's xEoY1KyrYls: imports without a question, clean Chinese, machine English starts.
2. Share a video with a human English track (to be identified before the check; record it here):
   the choice appears once; with the human track chosen, English shows without a full translation
   run (no translate.lock or translate.json for that job).
3. Confirm the download log shows no automatic-caption requests beyond Chinese (SC-5).
