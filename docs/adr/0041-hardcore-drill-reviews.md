# ADR-0041: Hardcore drill reviews, and a word drilled in at 14 days
Status: Accepted. Date: 2026-10-13. Amends: [ADR-0039](0039-which-words-are-cards.md) (what makes
a card active), [ADR-0040](0040-retired-words.md)'s amendment (what ends a set-aside mark),
[ADR-0037](0037-in-context-outcomes-and-fitted-rules.md)'s `evidence-4` (what counts as a sentence
seen before). Spec 014, issue #36.

Hardcore mode drills a fragment's words with that fragment's lines, around watching it. Each drill
grade is a **review labelled hardcore** (`detail.hardcore`, `detail.line`), recorded in a session
of modality `hardcore` with the session's plan and step records. It updates memory and enters the
personal FSRS fit like any review. It does not make the word a card, active, or no longer set
aside. Instead a word is **drilled in**, an active card for good, the first time its reading
stability reaches 14 days at any point from its first hardcore review on. A line shown on a drill
card counts as a sentence seen before for `evidence-4`'s discount. Hardcore reviews do not count
against the daily new-word budget.

Why: a drill brings many words at once (a 300-word film). Made active by their first grade, they
would flood Cards with reviews of words met an hour ago. At 90 % retention the next interval is
about the stability, so a word joining at 14 days adds about 1/14 review a day: a 20-word part
~1.4 a day, a 300-word film ~21 (the reader, 2026-10-12, issue #36). The word joins Cards already
known; until then it lives on reading, watching and drills. The reader wanted every grade counted,
in memory and in the fit, because FSRS should know the word was just seen; the watching before it
is in the replayed history. The line discount exists because right after a drill a word is
understood in its line from memory of the drill, not of the word.

How:
- `memory.ts`: hardcore reviews are evidence as before; `card`, `reviewed` and set-aside's
  `reviewedSince` ignore them. The reading fold tracks drilled in (`DRILLED_IN_DAYS = 14`); a
  drilled-in word is stored as a reviewed card. `ACTIVATION` becomes `known-2+drill-14`, so every
  memory is recomputed once by the background sweep and a later threshold change recomputes too.
- `repository.ts`: `wordHistory` counts hardcore review lines as viewings (never as exposures);
  `cardsToday` leaves hardcore reviews out of first reviews today.
- Records: [spec 014 contract](../../specs/014-hardcore-drill/contracts/hardcore-records.md).
  No migration: free-text kinds and JSON detail.

Rejected: making a drilled word active at once (floods Cards); a separate memory for drills (two
memories of one word disagree, and the fit could not learn from drills); leaving drills out of the
fit (the reader: FSRS should know); checking the threshold only right after a drill (the reader:
reading should carry a drilled word too); a `memory.card` code for drilled-in words (no behaviour
differs from a reviewed card); counting Cards' example sentences as seen before too (not asked
for; a one-line change if wanted).
