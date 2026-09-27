# Plan: The Reader Corrects The Segmentation

Short on purpose. Decided with the reader on 2026-09-27: all three stories, corrected tokens stored,
the analyzer's own output kept beside them.

## Shape

- **A correction** says how one written form is divided: `一个 → [一个]` (join) or
  `国人 → [国, 人]` (split). An undo says "no opinion about this form" — the analyzer decides again.
  One rule per form, the latest in force (FR-009). A fold over the history, computed on every write;
  there are few enough corrections that no projection table is worth having, which makes SC-006
  true by construction.
- **`correction_event`** (migration 004): append-only, ordered by `(device_id, device_seq)` from the
  same counter as marks, with the prompting occurrence (FR-007, FR-008). Earned; in the copy format's
  already-reserved `corrections` field.
- **`analyzed_token`** (migration 004): the analyzer's own output, exactly what `token` held before
  this slice. Derived. The migration copies `token` into it, since no correction exists yet.
- **`token`** becomes `apply(corrections, analyzed_token)` — what the reader sees, and what cards,
  memory and encounters already read. Nothing downstream changes (FR-011 is met by `analyzed_token`).
- **Applying** (pure, `domain/corrections.ts`): split rules first, on single tokens whose surface is
  the form; then joins, longest match left to right, over runs of adjacent *word* tokens whose
  concatenated surface is the form. A non-word token (punctuation, a line break, a unit delimiter)
  is never inside a run, so a join never crosses a boundary the writer put there (FR-003, ADR-0013),
  and an upgrade batch edge — always a unit edge — is never crossed either.
- **Lexeme keys** travel in the correction, as the language provider resolved them when it was made.
  The worker holds no reference to a provider (resolve.ts); for Chinese the key is the surface.
- **All three write paths** (`saveDocument`, `replaceTokens`, `advanceUpgrade`) store the analyzer's
  tokens into `analyzed_token` and the corrected ones into `token`. A restore re-derives through
  `replaceTokens`, so restored corrections apply with no path of their own (FR-010).
- **Making or undoing** a correction re-applies to every document whose text contains the form, in
  the same transaction as the event (FR-017, SC-002).

## UI

- The word sheet gets **Join with next** (refused with the reason when the next token is not a word)
  and **Split…** (for two or more characters: tap the gap to split at). SC-001: two taps.
- A **Corrections** page: every form with a rule in force, what it does, an Undo; linked from the
  library.

## Tested first (the irreversible surface)

Migration 004; the event append and its ordering; marks untouched by any correction (SC-004); the
applied tokens tile (property, SC-007); corrections survive `replaceTokens`/`advanceUpgrade`
(SC-003); copy round-trip. The UI gets one browser check, not a suite.
