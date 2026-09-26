# Quickstart: My Anki Words As A Starting Point

## On the laptop

```sh
python3 scripts/anki/export_words.py --push
```

Expect: `User 2, last changed <date>: 52 learning, 137 young, 1,039 mature, 900 long-term`, and the
file on the phone in Downloads. Check the collection is untouched: its checksum before and after is
identical (SC-005).

## On the phone

Diagnostics → Anki words → pick `anki-words.json` → check the preview → Import. Open a video: words
from Anki show in their level's shade; words you marked yourself keep their colour.

## Checks

- `npx vitest run tests/anki` — import, re-import, the reader's marks, undo, retraction replay.
- Import twice: the second import reports 0 changes (SC-003).
- Undo: every hand mark as before, Anki-only words unmarked (SC-004).
- `verify:browser anki` — the file picker, preview and import on a fixture file (plumbing only).

## Measured on the reader's phone (2026-09-26)

- Export: 2,122 distinct words (2,128 studied cards; 6 words are on two notes), 52 learning, 137
  young, 1,039 mature, 894 long-term. Collection checksum identical before and after (SC-005).
- Import: "2122 words set, 0 already as Anki has them, 0 kept as you marked them", in a few seconds.
- Picking the same file again previews "This sets 0 words, leaves 2122 already as Anki has them"
  (SC-003).
- Share of running words shaded from Anki (SC-001, at least half): street interview 68% (450 of
  661), Chef Wang 54% (186 of 344), tariff video 60% (1,237 of 2,062). Most of it is long-term.
- A word's sheet reads "Anki: long-term, from the import of 26/09/2026".
