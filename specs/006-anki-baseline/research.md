# Research: My Anki Words As A Starting Point

Measured on a copy of the reader's collection ("User 2", copied 2026-09-26).

## R1. What the collection holds

- Note type **HSK**, one card per note, the word in field **Simplified** (the 2nd field). All 2,128
  studied words are plain CJK characters (no markup, no brackets); 2,122 distinct, so 6 words are on
  two notes.
- FSRS is in use: every studied card's `data` holds `{"s": stability, "d": difficulty, …}`. Card
  `type`: 0 new (2,872), 1 learning (3), 2 review (2,124), 3 relearning (1). Queue −1 (suspended): 2.
- By stability: under 7 days **52** (with the 4 in (re)learning), 7–21 days **137**, 21–365 days
  **1,039**, over a year **900**.

**Decision**: strength = `data.s`, falling back to `ivl` (days) for a card without FSRS data; type 1 or
3 is Anki: learning whatever its stability. **Rejected**: interval alone. It is Anki's schedule, not
the memory estimate, and differs from stability by up to a band (the interval count gave 44/133/1,060
/887).

## R2. Reading without touching (Principle III, ADR-0006)

Anki desktop may hold the collection open with a write-ahead log. Copying `collection.anki2` and its
`-wal` together into a temporary directory and opening the copy read-only (`mode=ro`) reads the
latest committed state, without taking Anki's lock or writing a byte of the original.

**Decision**: a laptop script, `scripts/anki/export-words.py`, standard library only. **Rejected**:
the `anki` Python library (a dependency to read five fields); AnkiConnect (needs Anki running, and
writes are one call away).

## R3. Laptop to phone

The words are a few hundred KB of JSON. The reader's phone is often connected over USB, and has
Syncthing, but the app can already take a file from the phone's Downloads through the file picker.

**Decision**: the export script writes `anki-words.json`, and with `--push` copies it to the phone's
Downloads over adb. On the phone, Diagnostics → Anki → pick the file → preview → Import. Two taps and
a file choice; no typing (SC-002). **Rejected**: fetching through Termux (the service is on the phone,
the collection on the laptop, so it still needs a copy step, and one more path to keep alive).

## R4. Where the import's facts live

FR-004 needs every imported judgment to carry `anki`, its import and its strength. The event log
already has a free-text `provenance` column, meant for exactly this ("import from Anki" is named in
`Provenance`'s own comment), and the backup copies (spec 005) already carry it.

**Decision**: provenance `anki <importId> s=<stability>`, e.g. `anki 2026-09-26T21:04:11Z s=983.7`,
where the import id is the export's `exportedAt`. No migration, no copy-format change, and backups
carry imports by construction. **Rejected**: an `anki_import` table (a migration and a copy-format
version, for facts the provenance already holds).

## R5. Undo needs "no state"

The projection is last-event-wins, and nothing can say "never judged" again: an undo of an import
over an unmarked word had no event to append.

**Decision**: a retraction, an event whose `asserted` is the reserved value `(none)`. The projection
removes the word's state when it meets one, so the word shows as never judged (FR-006b). It is an
event like any other: replayed, copied, restored. Test-first, as it changes the projection.
**Rejected**: deleting the import's events (history is append-only, and copies already hold them);
asserting `unknown` (that is a judgment the reader never made).

## R6. Re-import and the reader's own marks

A word's current state decides everything:

| Current state | Anki now | Written |
|---|---|---|
| none | studied | the Anki level |
| from Anki, same level and stability | studied | nothing (FR-007) |
| from Anki, different level or stability | studied | the new Anki level |
| the reader's own (any other provenance) | anything | nothing (FR-005) |
| from Anki | no longer studied (reset, deleted) | nothing: left for the reader; noted as a limit |

Undo of an import: for each word whose **current** state is from that import, append the state the
word had just before that import's event (with that state's provenance), or a retraction if it had
none. Words a later import or the reader has since changed are left alone.
