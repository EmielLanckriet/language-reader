# Importing Anki into Reader

`python3 scripts/anki/export_words.py --push` exports studied words and scheduling seeds.
Reader → More → Anki words imports that JSON. Reader never writes back to Anki.

To retain the same cards’ examples and recordings:

```sh
python3 scripts/anki/export_examples.py --push
```

This opens the collection read-only, snapshots it, and exports studied HSK notes with their
`SentenceSimplified`, `SentenceMeaning`, `SentencePinyin.1`, `Audio` and `SentenceAudio` fields.
Use `--profile NAME` for another profile and `--out PATH` for another output location. The default
profile is `User 2`. The terminal reports missing audio and sentences that omit their headword.

On the phone, open **Reader → More → Anki examples and audio**, choose `anki-examples.tar` from
Downloads, and import. This supplementary import does not seed or replace scheduling. Reimporting
the same file repairs missing audio without duplicating example metadata. Reader prefers examples
from material actually encountered in Reader and otherwise uses these Anki examples.

Keep the bundle: regular logical backups contain example text and references, but do not contain
these audio files. Files are copied in bounded chunks to browser storage; allow enough free space
for both the downloaded bundle and its audio. Original Anki files remain untouched.

Tests: `python3 tests/anki/test_export_examples.py` uses a temporary synthetic collection.
