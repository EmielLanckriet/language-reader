# Data model: Hardcore mode

Earned rows are append-only, in the existing `session` and `encounter` tables (no migration).
Exact shapes: [contracts/hardcore-records.md](contracts/hardcore-records.md).

## Earned

| Record | Where | Holds |
|---|---|---|
| Hardcore session | `session`, modality `hardcore` | document, start, device order |
| Plan | encounter `hardcore-plan`, once, first in the session | options as chosen; every part's line range and words in drill order |
| Step | encounter `hardcore-step`, at a step's start and end | part, step, `start` or `end` |
| Drill grade | encounter `review` in the session | word, occurrence range, grade, `skill: reading`, `hardcore: {part}`, `line` |
| Watch link | encounter `hardcore-watch` in the player's own session | hardcore session, part, step |

Watching and reading in a step are the player's ordinary `played`/`read`/`attention`… encounters
in the player's own session, as today.

## Derived

- **Drillable word** (per word in the document): class `new` (no memory), `due` (active, due now),
  `not-active` (memory, not active), `set-aside`, or excluded (`active` not due, `retired` by
  hand); the shares' known flag; general-frequency rank.
- **Part**: consecutive lines; its words in drill order, each with its card line (first line of the
  part holding it). Computed at the start, then read back from the plan.
- **Session progress**: the next step is the first (part, step) in the plan with no `end` record.
  A part is done today when all its words were passed in a drill today.
- **Passed today**: words with a hardcore review graded 2–4 since the day began (day-end hour).
- **Memory** (`memory` table, rule key `evidence-4+no-steps+known-2+drill-14/…`):

```
not active ──hardcore review──▶ not active (memory grows, card/reviewed unchanged)
     │                                   │
     │ any evidence after the first      │ reading stability ≥ 14 d
     │ hardcore review with S ≥ 14 d     ▼
     └──────────────────────────────▶ drilled in = reviewed card (sticky; retired by hand ends it)
set aside ──hardcore review──▶ still set aside, until drilled in
due active card ──hardcore review──▶ next due from that grade (as from Cards)
```

A Cards review, an Anki seed and the known rule make a word active exactly as before.

## Validation

- `hardcore-plan` needs `detail.parts` (non-empty, each `lines: [first, last]`, `words: number[]`),
  `detail.steps` ⊆ {preview, watch-first, drill, watch-after}, non-empty.
- `hardcore-step` needs `part` (index into the plan), `step` (one of the four), `at: start|end`.
- A `review` with `hardcore` needs `hardcore.part` a number and `line: [from, to]` covering the
  review's range.
- `hardcore-watch` needs `session`, `part`, `step`.
