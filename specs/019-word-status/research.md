# Research: Word status

Measured on the reader's backup of 2026-10-16 (restored on the laptop, today's code): 2,772 words
with a reading memory, 2,111 active. Of those, 5 are active only by today's Anki-seed rule (top
2,000, under 14 days, never reviewed in Reader); none only by the known-word rule. Marks: 4,244
Anki levels, 1,036 `retired` (1,035 set aside, 4 by hand… one undone by a `(none)`), 3 `learning`,
3 `known`, 1 `unknown`, 0 `ignored`. Of the hand-retired words, 丁 is at 22 days, 其 at 4, 哪来 and
熊二 have no memory.

## R1 — Two tables: a log of changes and the current status

- Decision: `status_change` (earned, append-only: word, status, cause, when, device and sequence)
  and `word_status` (derived: the latest change per word), the same pair as `status_event` /
  `word_state`. Migration `006-word-status.sql`.
- Rationale: the reader asked for a separate status table. The constitution requires status
  history to replay to current status (Principle II), which a lone current-status table cannot
  show; the log also keeps when and why a word became active (#29, Anticipated Changes).
- Alternatives: one table holding only the current status (no replay, loses causes); status as
  marks in `status_event` (the reader chose a separate table; marks would also confuse the Anki
  import's "the reader's own mark" check).

## R2 — One activation function

- Decision: `src/lib/domain/status.ts` exports `activation(input)`, pure, returning `'stable'`,
  `'first-review'` or nothing. The repository calls it from one place, after a word's memory is
  recomputed (`recomputeMemory`), which every review, tap, exposure, parameter change and sweep
  already goes through; a status change it returns is appended there and nowhere else.
- Input: the word's current status and the position of its latest change; the position of its
  latest change to `retired` made by the reader; the switch's position; the reading fold's
  stability after each piece of evidence, with each evidence's position and whether it was a Cards
  review (not a drill). Positions are `(device_id, device_seq)`, the history's order.
- Rationale: FR-005 and SC-002. The function sees only history and statuses, so it is tested
  without storage.

## R3 — The two rules, exactly

- `stable`: current status `retired`, and some evidence's reading stability (or the Anki seed's)
  is ≥ 14 days. If the reader retired the word, only evidence after that retire counts, and only
  after the stability was below 14 at or after it (the stability standing at the retire counts as
  "at it").
- `first-review`: current status `retired`, and a Cards review (not a drill) comes after both the
  word's latest status change and the switch. The switch bound keeps reviews made before it (for
  example of set-aside words before they were set aside) from activating anything.
- `ignored` and `active` return nothing. Alternatives: activating on the pick itself (rejected in
  the spec's assumptions: a pick shown and skipped would become active and come due at once).

## R4 — The switch

- Decision: `Repository.switchToStatuses()`, called when the storage worker opens the database
  (beside `ensureMemory`) and at the end of `restoreCopy`; runs when the history holds no
  `status-switch` encounter. One transaction: (1) words active under the old rule get `active`
  (`carried-over`); (2) marks asserting `ignored`, `learning`, `known`, `unknown` or `retired` are
  deleted, and each `(none)` whose word's previous mark is one of those; (3) `word_state` is
  rebuilt from what remains; (4) a `status-switch` encounter records the counts. Memory is then
  recomputed by the sweep, as for any rule-key change.
- Old rule: a reading memory row computed under the old rule key gives it directly
  (`card IN (1,2) AND (reviewed = 1 OR seeded IS NOT NULL OR card = 2)`); a word without such a row
  (a restore, or a sweep not yet finished) is computed by `legacyActive` in
  `src/lib/domain/legacy-active.ts`, a frozen copy of today's flags, used by nothing else.
- Rationale: on the phone the rows are current, so the switch is one query and the first screen is
  not held up (Principle VIII); a restore has no rows and pays a fold per word, as restoring does
  already. Running at open, not in the idle catch-up, means no screen ever reads an empty status
  table. The encounter rides in the copy, so a copy made after the switch never runs it again and
  one made before always does (FR-018).
- Check before the change: characterization tests pin today's `isActive(memoryOf(…))` on the
  histories that matter (known, seeded under and over 14, set aside under and over 14, hand
  retired, `learning` mark, tapped and never reviewed); `legacyActive` must pass them, and they
  stay as its tests.

## R5 — Backup format 4

- Decision: `statuses: [{ deviceId, deviceSeq, language, surface, status, cause, at, userId }]`,
  words by surface like marks. Upgrading 3 → 4 adds `statuses: []`. Export refuses when
  `word_status` is not the replay of `status_change`; restore replays and checks it, then runs the
  switch if the copy has no `status-switch` encounter.

## R6 — Memory loses its card flags

- Decision: `Memory` drops `card`, `known`, `setAside` and `reviewed`; `WordEvidence` drops `card`,
  `known`, `setAside` and `retired`; `evidenceFor` no longer reads marks except for the Anki seed;
  the `ignored` early return goes. The `memory` table keeps its `card` and `reviewed` columns
  (written 0) because the switch reads them; dropping them is a later migration once no pre-switch
  database remains (Anticipated Changes). `ACTIVATION` leaves the rule key; `RULE` becomes
  `evidence-5` so every row is recomputed once.
- Not changed: evidence and FSRS. Stabilities are the same before and after (only flags move).

## R7 — Readers of status

- Cards (`cardsToday`): due = `active` and due; learn-ahead as before for `active`; new = tapped,
  `retired`, with a reading memory and a sentence, frequency order, budget less first reviews
  today. The `MET_WORDS` path for set-aside words goes.
- Library due counts (`isDueWord`) and the queue read status instead of memory flags; shares and
  hardcore's coverage target read recall only (`kindOf` loses marks).
- Hardcore: `classify` unchanged; planning and the drill's start leave out `ignored` words.
- Buttons write `reader` changes through one repository method, `setStatus(lexemeId, status)`;
  Undo writes the previous status back the same way (FR-014).
- Word list: deck status becomes the status; the mark column shows only Anki levels.
- `retireIgnored`, `setAsideAnki` and their protocol entries go.
