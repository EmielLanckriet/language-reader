# Data Model: spec 007

Migration `003-encounters.sql`. Earned tables are append-only: no UPDATE or DELETE in any code path,
as with `status_event`.

## session (earned)

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| document_id | INTEGER NOT NULL → document | |
| modality | TEXT NOT NULL | `reading` (a text) or `media` (video/audio); free text |
| started_at | TEXT NOT NULL | device wall-clock, ISO |
| device_id | TEXT NOT NULL → device | |
| device_seq | INTEGER NOT NULL | from `device.next_seq`, shared with `status_event` |
| user_id | INTEGER NOT NULL DEFAULT 1 | |

Unique `(device_id, device_seq)`. No end column: a session ends at its last encounter.

## encounter (earned)

| Column | Type | Notes |
|---|---|---|
| id | INTEGER PK | |
| session_id | INTEGER → session | null only for a review outside a session |
| kind | TEXT NOT NULL | `read`, `played`, `seek`, `lookup`, `check`, `replay`, `translation`, `setting`, `attention`, `review`; free text |
| lexeme_id | INTEGER → lexeme | set for `lookup`, `check`, `review`; null otherwise |
| document_id | INTEGER → document | null only for `attention`/`setting` |
| from_offset, to_offset | INTEGER | code points into `raw_content` |
| media_ms | INTEGER | position in the media at the event (start, for a range) |
| speed | REAL | playback rate, media only |
| text_visible | INTEGER | 0/1, media only: was the line's text on screen |
| detail | TEXT NOT NULL DEFAULT '{}' | JSON, per kind (below) |
| at | TEXT NOT NULL | device wall-clock, ISO |
| device_id, device_seq | | shared counter; unique pair |
| user_id | INTEGER NOT NULL DEFAULT 1 | |

Indexes: `(session_id)`, `(lexeme_id)`, `(document_id, from_offset)`, unique `(device_id, device_seq)`.

`detail` by kind:
- **played**: `{toMs}`
- **seek**: `{fromMs, toMs}`
- **replay**: `{line, toPrevious}`
- **translation**: `{line, source}` (`quick`/`llm`)
- **setting**: `{name, value}` (`speed`, `stopAfterLine`)
- **attention**: `{answer}` (`all`, `some`, `none`, or `null` when dismissed)
- **review**: `{skill, grade}` (`reading`; 1–4). The offsets are the sentence shown.

Validation: the repository checks, per kind, that the required columns are present. It refuses a
`lookup` without a lexeme, a `review` without a grade, and so on. Unknown kinds are accepted: a
newer build may write them.

## memory (derived — recomputable, never copied)

| Column | Type | Notes |
|---|---|---|
| lexeme_id, skill | PK | skill `reading` / `listening` |
| stability, difficulty | REAL | |
| state | INTEGER | ts-fsrs `State` |
| last_at, due | TEXT | ISO |
| reps, lapses | INTEGER | |
| card | INTEGER | 0/1: a card-creating event under the rule (R8) |
| reviewed | INTEGER | 0/1: has an in-app review (new vs reviewed card) |
| seeded | TEXT | `anki` / null; plus whether the last-review date was known |
| rule | TEXT NOT NULL | e.g. `evidence-1`; rows under an older rule are recomputed by the sweep |

A missing row means "no evidence", never "unknown".

## document (changed)

`removed_at TEXT` (nullable): hidden from the library, media files gone, text and tokens kept (R11).

## Status-event provenance (changed, no schema change)

Anki: `anki <importId> s=<stability> d=<difficulty> r=<lastReview>`. The format-1 form
`anki <importId> s=<stability>` is still read (R10).

## Relationships

- `encounter.session_id` → `session`
- `session.document_id`, `encounter.document_id` → `document`
- `encounter.lexeme_id`, `memory.lexeme_id` → `lexeme`

Lexemes referenced by encounters are never deleted (CLAUDE.md: the irreversible surface).
