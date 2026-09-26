# Data Model: My Anki Words As A Starting Point

No migration. Everything below fits the existing tables (spec 001's `lexeme`, `status_event`,
`word_state`).

## Anki word (in the export file only)

| Field | Meaning |
|---|---|
| `word` | the Simplified field, the Chinese word |
| `level` | `anki-learning` · `anki-young` · `anki-mature` · `anki-long-term` (research R1) |
| `stability` | FSRS stability in days, or the interval where there is none |
| `type`, `lapses`, `suspended` | as Anki records them; shown in the preview, not stored |

## Imported judgment (an ordinary `status_event`)

- `asserted`: the Anki level, one of the four above. The reader's own four states are unchanged.
- `provenance`: `anki <importId> s=<stability>` (research R4). Anything else is the reader's own.
- `document_id`, offsets: null. An import is not made in a document.
- The word's `lexeme` is found or created (`zh`, the word), so a word in no document yet has a state
  (FR-009).

## Retraction (new)

An event with `asserted = '(none)'`. Projecting it removes the word's `word_state` row. Only undo
writes one today.

## Import

Not stored as a row: an import is the set of events whose provenance names its id. Its report and
its undo are computed from the log.

## State rules

See research R6. In short: a word's state is written by an import only when it has none or its
current one is from Anki and differs; undo reverts only words whose current state is from that import.
