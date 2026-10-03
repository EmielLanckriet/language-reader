# Data model: Personal FSRS fitting

Nothing earned changes shape. Two encounter kinds are added (append-only, free-text kinds that
backups already carry); everything else is derived.

## New encounter kinds (earned)

- **`tap-undone`**: word, offsets, document, session. The reader undid the tap while its sheet
  was open. No lookup is written for it. Evidence ignores it.
- **`fsrs-activation`**: no session. `detail = { set: ParameterSet, action: 'apply' | 'rollback',
  comparedWith: string }`. The latest activation, ordered by `at` then device and sequence, names
  the active set; with none, the latest `anki-parameters` (or defaults) is active, as today.
  Validation: a well-formed set (below) and an action.

## Derived: item stream (per word, history order)

| Item | From | Fields |
|---|---|---|
| `review` | review encounter | skill, grade |
| `tap` | lookup, or check with `knew: 'knew'`, not followed by `tap-undone` | session |
| `seen` | read/played stretches of a session | skill, session, `answer`, `helped` (every occurrence helped), `textVisible` |

`evidence-3` (Story 1) = `evidence-2` with: checks with `knew: 'knew'` are taps; a `seen` item
gives its Good only if not `helped`; Known/Ignored-from-sheet closes are not taps.

## Derived: outcomes (scored, never stored)

| Type | Rule | Label |
|---|---|---|
| `card` | review with prior memory, dated, ≥ 24 h since previous item | Again 0, else 1 |
| `in-context` | first `tap` of a word in a non-withdrawn session | 0 |
| `in-context` | `seen`, reading skill, answer `all`, not helped, no tap that session | 1 |

One in-context outcome per word per session. Listening items are inputs only.

## ParameterSet (file and activation payload)

| Field | Meaning | Bounds |
|---|---|---|
| `id` | hash of the fields below | — |
| `model` | `fit-1` | — |
| `weights` | 21 FSRS-6 weights | `CLAMP_PARAMETERS` |
| `seenReading`, `seenListening` | stability gain of an unhelped seen item, as a multiple of a Good's | [0, 2]; 1 = evidence-3 |
| `tapStability` | stability after a tap, as a multiple of an Again's | [0.2, 5]; 1 = evidence-3 |
| `falseSuccess` (a), `falseFailure` (b) | P(observed success) = a + (1−a−b)·R | a, b ∈ [0, 0.4] |
| `retention` | the reader's preference, copied, never fitted | (0, 1) |
| `provenance` | export time, fit time, γ, iterations | — |
| `report` | later-period scores, verdict, `comparedWith` (active set id at export) | — |

The evidence-3 baseline is the set {Anki weights, all multipliers 1, a = b = 0}, so today's rule
is a point in this space and the fit can only move away from it when the data supports it.

## Activation state transitions

`none → applied(A) → applied(B) → rolled back(A) …` — each step one `fsrs-activation`; memory
rows whose `ruleKey` differs from the active set's are stale and recomputed by the sweep.
