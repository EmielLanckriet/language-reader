# ADR-0028: Corrections Are Rules About Forms, Applied Over The Analyzer's Kept Output

**Status**: Accepted
**Date**: 2026-09-27
**Relates to**: spec 004, ADR-0003 (earned vs derived), ADR-0011 (analyzer stamp), ADR-0013 (units)

## Context

The reader needs to correct segmentation: every analyzer is wrong about some boundary (一 · 个 under
the model). A correction is earned. Everything downstream (cards, memory, encounters) reads `token`.

## Decision

- **One rule shape**: "this form divides into these parts". `一个 → [一个]` joins, `国人 → [国, 人]`
  splits. The rule applies wherever a run of adjacent *word* tokens exactly covers the form, whatever
  the analyzer's cuts inside it were. Runs never contain a non-word token, so a correction never
  crosses punctuation, a line break or a unit edge.
- **`correction_event`**: append-only, sharing the device sequence; an undo is a row with no parts.
  Latest per form is in force. There is no projection table. The fold runs on every write, which is
  cheap at this size.
- **`analyzed_token`** keeps the analyzer's own output. **`token`** is that output with corrections
  applied. It is written by one repository helper, so no path stores one without the other.
  Making or undoing a correction rewrites the affected documents from `analyzed_token`, with no
  analyzer run.
- **Lexeme keys travel in the correction**, as the language provider resolved them at the time,
  because the worker holds no provider.
- **Copy format 3** carries the events. A restore re-derives through `replaceTokens`, which applies
  them.

## Alternatives Rejected

- **An overlay at read time**: cards, memory and encounters would never see a joined word.
- **Corrected tokens only, re-analysing on undo**: an undo would cost a model run of about 4 s per
  1,000 characters, per affected document.
- **Separate join and split events**: two rules could contradict each other about one form. With
  one rule per form, "the latest wins" is well defined.

## Consequences

- A rule does not apply where the words cut across the form (人一 · 个 never shows 一个). Since the
  2026-10-05 amendment, "the words" are those the earlier corrections left, not the analyzer's.
- If the lexeme-key rule ever changes, the keys stored in corrections need the same re-keying pass
  as lexemes.
- Per-occurrence exceptions (国人 in 国人皆知) remain out of scope. Undo is the remedy.

## Amendment, 2026-10-05: corrections apply in the order they were made

Issue #2. The analyzer cut 乾崑智 · 驾; the reader split 乾崑智 → 乾崑 · 智, then joined 智 · 驾, which
the word sheet offered because it works on the corrected words on screen. One pass over the
analyzer's tokens, longest form first, could never apply that join: 智 is not a whole analyzer
token. It was recorded seven times and never took effect, with no sign of it.

- **The rules apply in order**, each over the tokens the ones before it left. The order is when
  each form's latest correction was made (the same device-and-sequence order as the fold), so
  deciding a form again moves it to the end. A rule therefore applies where the reader saw its form
  when they made it. Undo, "latest per form wins", runs of words only and tiling are unchanged.
- **Joins and splits no longer count as lookups.** The tap that opens the sheet to correct a word
  is recorded as `tap-undone` with `{"reason":"correction"}`, which carries no memory weight.
- **Existing documents are brought up to date** when the app opens: `reapplyCorrections` re-applies
  the rules to each document holding one of their forms and rewrites only those whose words come
  out different, with the same memory refresh as making a correction.

Rejected: corrections as character boundaries, where a split adds boundaries, a join removes them
and the newest wins per boundary. More principled, but a larger change to the segmentation
properties; replaying in order matches what the reader saw at each correction with a smaller
change. Rejected also: refusing such a join in the sheet, which would make 乾崑 · 智驾 impossible.

