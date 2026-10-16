# ADR-0043: Following without the picture, and why a word was tapped
Status: Accepted. Date: 2026-10-16. Spec 017, issue #29.

Two optional facts join the history, both in existing records' `detail`, so no new kinds and no
migration:

- The **engagement** answer may carry `followable`: `yes` / `partly` / `no` / null, asked after
  "Only listened": could the reader follow the video without the picture?
- A **lookup** may carry `reason`: `unknown` (didn't know it), `sense` (checking the meaning here),
  `split` (wrongly split), `misheard`, `subtitles` (the subtitles are wrong).

Validation refuses any other value; absence is valid, as every older record lacks them. Nothing
reads them yet: memory, cards, the shares and the fit are unchanged.

Why: issue #29's analysis needs them. How well a video comes through by sound alone is the main
confounder for whether listening helps (the reader: Peppa Pig works without the picture, others
not), and 13 of the 25 worst predictions were single characters inside compounds, taps whose cause
only the reader knows. A tap that was really a segmentation or transcript fault is not evidence of
not knowing the word; recording why is the first step to treating it so.

Where: the follow question sits with the other session questions (`SessionQuestions.svelte`) and
is part of the engagement record, so its latest answer counts and earlier ones stay, as for
watched/listened. The reason is chosen in the word sheet and written with the lookup when the sheet
closes (`recorder.ts` `closed`), so it needs no record of its own and an undone tap carries none.

Rejected: a per-video rating outside sessions (the same video sounds different on different days,
and the session is where the question is already asked); a reason for every tap, required (taps
must stay one gesture).
