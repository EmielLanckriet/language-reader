# Data model: Word status

## `status_change` — earned, append-only

| column | type | |
|---|---|---|
| `id` | INTEGER PK | |
| `lexeme_id` | INTEGER NOT NULL → lexeme | |
| `status` | TEXT NOT NULL | `retired` / `active` / `ignored`; free text like marks, validated on write |
| `cause` | TEXT NOT NULL | `reader` / `stable` / `first-review` / `carried-over` |
| `changed_at` | TEXT NOT NULL | device clock; display only |
| `device_id` | TEXT NOT NULL → device | with `device_seq`, the history order (shared counter) |
| `device_seq` | INTEGER NOT NULL | |
| `user_id` | INTEGER NOT NULL DEFAULT 1 | |

Index on `lexeme_id`. Never updated or deleted.

## `word_status` — derived

| column | type | |
|---|---|---|
| `lexeme_id` | INTEGER PK → lexeme | |
| `status` | TEXT NOT NULL | the latest change's |

Rebuilt by replaying `status_change` in history order (`rebuildStatuses`, tested to change
nothing). A word with no row is `retired`.

## Transitions

| from | to | who | cause |
|---|---|---|---|
| retired | active | `activation` | `stable` or `first-review` |
| retired, active | ignored | reader | `reader` |
| active | retired | reader | `reader` |
| ignored | its status before the ignore | reader (undo, un-ignore) | `reader` |
| retired | active | reader (Undo of a Retire) | `reader` |
| (none) | active | the switch | `carried-over` |

No other edge: `activation` never leaves `ignored` or `active`.

## Encounter `status-switch` — earned

`detail: { carried: number, deletedMarks: number }`. One per library; its position bounds
`first-review` (research R3).

## `memory` — derived, changed

`card` and `reviewed` are written 0 and read only by the switch; `Memory` and `WordEvidence` lose
their card flags (research R6). Rule key `evidence-5+no-steps/…`.

## `status_event` / `word_state` — earned / derived, changed by the switch only

After the switch they hold Anki levels and `(none)` only.
