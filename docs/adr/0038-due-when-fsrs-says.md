# ADR-0038: A word is due when FSRS says, with no learning steps
Status: Accepted. Date: 2026-10-04. Amends: [ADR-0027](0027-encounter-log-and-derived-memory.md) scheduling only.

Every memory's due date is the moment FSRS's forgetting curve reaches the retention target:
`last review + stability × interval modifier` days, unrounded and capped at the maximum interval.
That can be hours for a word just tapped and is never rounded to whole days. It holds for reading in
context and for card answers alike, and for Anki seeds. ts-fsrs's learning and relearning steps
(1 and 10 minutes) no longer set any due date.

Why: after watching "Are Chinese People Rude?" (2026-10-04) the library's due count rose from 102
to 123. Of 121 words due at the end, 106 were in a learning step: every word read untapped for the
first time came due 10 minutes later, every tapped word 1–10 minutes later, while reading can credit
a word only once a day and never in the session it was tapped in. The steps made due words that
nothing but a card could clear. The reader: "I trust the algorithm, learning steps aren't needed."

Unchanged: stability and difficulty. The scheduler keeps `enable_short_term` for its same-day
stability formula, which `fsrs6.ts` and the fit's replay reproduce, so fitted sets, exports
(`evidence-3`) and their scores are unaffected. ts-fsrs still tracks Learning/Relearning internally;
the colour band keeps treating those words as fragile. The stored-memory key gains `+no-steps`, so
the sweep recomputes every word once.

Consequences: an Again on a card comes back when its short stability says, typically hours, not
in the same card session. "% today" in the word menu still counts whole days as ts-fsrs does, so a
word tapped this morning can read 100 % while already due in the afternoon.
