# ADR-0040: Retired words leave the deck but keep their memory
Status: Accepted. Date: 2026-10-06. Amends: [ADR-0039](0039-which-words-are-cards.md) (which words are cards).

A word whose latest mark is **`retired`** is never a card: not active, not a candidate, never due,
and left out of the library's "due come up" counts. Its memory goes on as before: reading and
listening still update it, the read page colours it by recall, and the library's shares count it as
known or learning by that recall. Retiring is a mark like any other, so it is undone by marking the
word again; `(none)` takes the mark back.

Why: the reader asked for a way to stop drilling a word without losing it (2026-10-06: "it will
never come up in the flashcards and never be due, but it has a memory and is part of the deck").
`ignored` already removed a word from cards, but it also drops its memory and leaves it out of the
shares, as for names and noise. The reader called ignoring "a useless concept", so it is no longer
offered, and at the reader's request words already ignored are retired (below).

How:
- `state.ts`: `retired` joins the stored state names. Like every state name it is never renamed.
- `memory.ts`: `evidenceFor` sets `card` and `known` false when the latest mark is `retired`; the
  evidence itself is unchanged. No rule-key change: no stored memory had a retired mark.
- Cards: "Retire this card" on both faces, with Undo, which restores the mark the word had before.
- Word sheet: Unknown/Learning/Known/Ignored are replaced by one Retire button (tap again to undo).
  Older marks keep counting as before.
- `retireIgnored`, run when the app opens after `reapplyCorrections`: every word whose current mark
  is `ignored` gets an appended `retired` mark with provenance "converted from ignored (ADR-0040)".
  The `ignored` marks stay in the history; a second run finds nothing to do.

## Amendment 2026-10-07: setting Anki words aside

The reader, annoyed by a queue of 253 due cards that were all Anki words: retire the Anki words
outside the 2,000 most common in general Chinese, and let one come back only by coming up in what
they read or watch, among the most common new words. A **set-aside** word is a `retired` mark with
provenance "set aside: outside the N most common words". Unlike a plain retire it stays a card
(`memory.card` 3), never due by itself: once met while reading, watching or tapping (an Anki
example sentence does not count), it is a new-word candidate ranked by general frequency under the
daily budget; a Reader review after the mark makes it an ordinary card again, starting from its
Anki memory. `setAsideAnki(top, dryRun)` marks every word whose current mark is an Anki level and
whose rank is not below `top`; an Anki re-import keeps these marks (the reader's own), and Undo or
any later mark ends them. This revises ADR-0039's "seeded words stay active".
