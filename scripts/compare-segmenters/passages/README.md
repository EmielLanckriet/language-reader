# Passages

Put the reader's own material here as plain `.txt` files (UTF-8), one passage per file. Nothing
else belongs in this directory.

This is deliberately **not a benchmark corpus**. FR-026 requires the comparison to run over passages
of the reader's own material, because word-hood is learner-dependent on this project (ADR-0002) —
agreement with someone else's annotator is not the question being asked. The question is which
segmenter serves *this* reader on *what they actually read*.

## What to put here

- At least five passages (SC-007), pasted as `.txt` files.
- At least two of them subtitle- or transcript-like: short spoken-language lines, one utterance per
  physical line. This is the material FR-028 requires to be reported separately from long prose, and
  it is what the reader expects to be reading most.
- The rest can be whatever the reader is actually reading — articles, book excerpts, anything with
  enough length to exercise ordinary prose segmentation.

## What not to put here

- **No sample or placeholder text.** `run.mjs` was verified against a few throwaway lines while it
  was being built, and that text was deleted before this harness was finished — committing it here
  would silently become the thing being measured, which defeats the entire point of this directory.
- **No benchmark corpus** (news text, a textbook's example sentences, anything not actually read).

## How lines are classified

`run.mjs` reads each file's physical lines (split on `\n`). A line at or under 20 code points is
treated as short spoken-language material; anything longer is long prose (see the threshold's
rationale in `run.mjs`, next to `SHORT_LINE_THRESHOLD`). There is no metadata to classify by — plain
text is all a pasted passage is — so line length is what the harness infers from.
