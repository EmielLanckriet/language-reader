# Contract: The Copy Format

A copy is a UTF-8 JSON file. Fields are listed in [data-model.md](../data-model.md). This file
states the rules that make a copy restorable, and that tests hold to.

## Writing

1. The snapshot is taken in **one read transaction**, so events and states are consistent.
2. `states` MUST equal the projection of `events`. The writer checks this and refuses to send a
   copy that fails it. The failure is recorded in diagnostics, because it means the database itself
   disagrees with its log.
3. `integrity` = SHA-256, hex, of the JSON serialisation of the object without `integrity`, with keys
   sorted at every level.

## Restoring

1. **Validate before writing anything**: the JSON parses, `format` is known, `integrity` matches, and
   every `documentId` and `deviceId` in `events` exists in the copy. A failure writes nothing and
   says which check failed.
2. **Refuse a library with marks**: if any word state or status event exists, stop and explain.
   A library holding only documents is joined: the copy's documents are added beside them.
3. **One transaction**: the device that wrote the copy replaces the fresh install's unused one, so
   new marks continue its sequence; documents are **renumbered** (events follow them); lexemes are
   found or created by `(language, surface)`; events are appended in order; then the projection is
   replayed. The resulting states MUST equal `states`, or the transaction rolls back.
4. **After commit**: documents carry no tokens; they are stamped `restored`, so opening one
   re-derives it and the sweep upgrades it, as for any stale document. Media documents get their
   subtitle file written to `media/<id>/`. The video is fetched through the service when it can be
   found (R8). None of this is earned; failures leave readable documents.

## Older formats

A copy of format *n* is upgraded one step at a time to the current format, by pure functions
`upgrade_n_to_n+1`. A fixture copy of every format ever written lives in
`tests/fixtures/copies/format-<n>.json`, and every release restores all of them (SC-005).
