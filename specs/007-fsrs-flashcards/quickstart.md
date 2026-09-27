# Quickstart: validating spec 007

Short fixtures (a 90 s clip, a short text), per the project's habit. Full-length runs only for SC-006.

## Laptop

1. `npm test`: the evidence-rule contract (contracts/evidence-rule.md), encounter append/validation,
   rebuild-equals-incremental, copy format 1→2, and Anki format 1 and 2 provenance.
2. `python3 scripts/anki/export_words.py --profile "User 2"`: check that `anki-words.json` says
   `"format": 2` and that studied words have `difficulty` and `lastReview`. Compare the collection
   file's hash before and after (SC-005 of spec 006 still holds).
3. `npm run verify:browser`, only the scenarios this reaches: media playback (encounters written),
   the reading page (read ranges, colours), and the new flashcard page.

## Phone (one deploy for all of it)

1. **Story 1 / SC-001**: open the 90 s clip. Do the following:
   - look up two words;
   - answer "I knew it" on one lookup;
   - replay a line, and double-replay once;
   - open one translation;
   - seek 30 s forward;
   - change the speed;
   - leave, and answer "all".

   On the diagnostics page, the session's encounters list exactly these, in order, with the speed
   and text visibility.
2. **SC-002**: start the clip, play 20 s, kill the app from recents. On reopening, the played chunks
   end no more than 5 s before the kill.
3. **Story 2 / SC-003, SC-004**: after an Anki import (format 2), the flashcard page's due count is
   within 20% of AnkiDroid's due count for the same day. A lookup changes the word's shade on the
   stage and in a text containing it, with no reload.
4. **Story 3 / SC-005**: review ten cards. The next card appears within 0.5 s of each grade (timed
   over CDP), and an Again comes back within the session.
5. **Delete**: delete a watched video. It leaves the library, its file is gone, and its encounters
   are still listed.
6. **SC-006**: bump the rule name in a debug build. The colours stay while the sweep recomputes, and
   the recompute finishes in under 30 s.
