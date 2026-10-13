# Contract: hardcore records (earned, append-only)

Settled before the first row is written (Principle V). Field names are never renamed; a later
build may add fields, and readers ignore unknown ones.

## Session row

`session (document_id, modality = 'hardcore', started_at, device_id, device_seq)` via
`startSession(documentId, 'hardcore')`.

## `hardcore-plan` (first encounter of the session)

```json
{
  "kind": "hardcore-plan",
  "detail": {
    "start": "beginning | continue | range",
    "fragment": [0, 211],
    "cut": null,
    "steps": ["preview", "watch-first", "drill", "watch-after"],
    "filters": { "minOccurrences": 2, "topRank": 2000, "coverage": 0.95 },
    "order": "frequency | story",
    "parts": [{ "lines": [0, 37], "words": [881, 102, 4410] }]
  }
}
```

`fragment` and `parts[].lines` are inclusive line indices; `cut` is `{ "size": 20 }` when cut by
load. An absent filter is omitted. No range fields: the session row names the document, and
nothing that reads ranges generically should take a plan for a viewing.

## `hardcore-step`

```json
{ "kind": "hardcore-step", "detail": { "part": 0, "step": "drill", "at": "start" } }
```

## `review` from a drill

```json
{
  "kind": "review",
  "lexemeId": 881,
  "documentId": 12, "fromOffset": 130, "toOffset": 132,
  "detail": { "skill": "reading", "grade": 3, "hardcore": { "part": 0 }, "line": [118, 141] }
}
```

Same as a Cards review except `hardcore` and `line`, and the hardcore session as its session.
Every grade is one record, repeats after Again included.

## `hardcore-watch` (in the player's own session)

```json
{ "kind": "hardcore-watch", "detail": { "session": 57, "part": 0, "step": "watch-after" } }
```

Written once, with the player's first encounters, when the player was opened from a step.

## Repository surface (worker protocol)

- `startSession(documentId, 'hardcore')` → session id (existing).
- `recordEncounters(sessionId, encounters)` (existing) for plan, steps and drill reviews; memory of
  each reviewed word is recomputed in the same transaction.
- `hardcoreWords(documentId)` → per word: class, known, rank; and passed-today ids (new).
- `hardcoreSession(sessionId)` → plan and step records (new).
