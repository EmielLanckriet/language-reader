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

- A rule does not apply where the analyzer cuts across the form (人一 · 个 never shows 一个). That
  is inert, not wrong, and a join made there records the form the reader actually saw.
- If the lexeme-key rule ever changes, the keys stored in corrections need the same re-keying pass
  as lexemes.
- Per-occurrence exceptions (国人 in 国人皆知) remain out of scope. Undo is the remedy.
