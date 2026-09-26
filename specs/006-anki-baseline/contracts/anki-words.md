# Contract: `anki-words.json`

Written on the laptop by `scripts/anki/export_words.py`, read on the phone by Reader. UTF-8 JSON.

```json
{
  "format": 1,
  "profile": "User 2",
  "collectionModified": "2026-09-26T05:13:00Z",
  "exportedAt": "2026-09-26T21:04:11Z",
  "words": [
    { "word": "将来", "level": "anki-long-term", "stability": 983.7, "type": 2, "lapses": 0, "suspended": false }
  ]
}
```

- `format` is 1; Reader refuses any other, saying so.
- `exportedAt` is the import's id (research R4). Exporting again gives a new id.
- `words` holds studied cards only (type ≠ 0, FR-011), one entry per distinct word, the strongest card
  where a word is on two notes.
- `level` is computed on the laptop (research R1), so the phone does not need Anki's rules.

## Script

```text
python3 scripts/anki/export_words.py [--profile "User 2"] [--out anki-words.json] [--push]
```

- Copies `collection.anki2` (and `-wal` if present) to a temporary directory and reads the copy
  read-only. Never opens the original (FR-002, SC-005).
- Prints the profile, when the collection was last changed, and the count per level.
- `--push` copies the file to the phone's `/sdcard/Download/` with adb, if a phone is connected.

## Reader

Diagnostics → **Anki words**: pick the file → a preview (profile, last changed, counts per level,
how many words it will set and how many it leaves because the reader marked them) → **Import**. After
an import, **Undo this import** reverts it (research R6).
