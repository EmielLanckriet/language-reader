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
