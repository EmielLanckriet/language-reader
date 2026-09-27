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

## Measured on the phone, 2026-09-27 (Samsung A71, installed app)

| Check | Result |
|---|---|
| Update to 007, migration 003, memory built for the existing library | done; no wait noticed |
| Anki format 2 import, 2,122 words with parameters | 5.9 s (laptop 2.4 s: the phone is ~2.5× slower) |
| SC-003 due today | Reader 143, Anki 177 (173 review + 4 learning): 19 % lower, inside 20 % |
| SC-002 kill mid-video | ~3.6 s of watching lost (last chunk 48.2 s, video at ~50.9 s) |
| SC-004 lookup → colour | 121 ms, to the fragile band |
| Check ("I knew it") on an Anki word | recorded; sheet said "Reading: 99% today, next review in 580 days" |
| Cards tab | 143 due, first card an Anki word in no document, shown alone |

Not run on the phone, to keep test entries out of the reader's append-only history: grading
cards (0.2 s between cards in the browser), the attention question, delete-keeps-text, and a rule
change's recompute (SC-006; a full rebuild is estimated at ~12 s from the laptop's 4.8 s). One test
lookup landed on 这个, a word the reader knows: it is a new card and one lookup in their history.

