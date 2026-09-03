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

- **No benchmark corpus** (news text, a textbook's example sentences, anything not actually read).

## What is actually here, and why that weakens the conclusion (2026-09-03)

The five passages committed here are **not the reader's own material**. The reader declined to
collect any and asked for passages to be written instead, so they were generated to match the
*kinds* of material recorded in the product direction: everyday spoken dialogue, a video
transcript, and connected prose of the sort read for interest rather than study.

This is a real weakening and it is written down here so that nobody reads the report as stronger
evidence than it is:

- **The material and the answer key have the same author.** Whoever writes the passages and then
  hand-marks the words in them is scoring segmenters against their own beliefs about word-hood, on
  text they chose. A candidate that happens to divide words the way the author does will score well
  for a reason that has nothing to do with serving a reader.
- **Word-hood is learner-dependent on this project** (ADR-0002). Generated text cannot show what
  *this* reader finds hard, which is the thing FR-026 asked the comparison to measure.

Two things limit the damage, and neither removes it. First, the passages are ordinary connected
text on ordinary topics, not a list of contested words — a passage assembled from cases whose
answers were already known would measure nothing. Second, the hand-marking in T038 adjudicates
only the spans where candidates actually *disagree*, rather than authoring a full answer key from
scratch, which is a much narrower place for an author's bias to act.

An earlier version of this file forbade exactly this ("no sample or placeholder text"), on the
grounds that placeholder text would silently become the thing being measured. That reasoning still
stands. It is not silent now: the report and the conclusion in research.md both say what the
passages are. **If the reader ever does paste real material, delete these and re-run — the
conclusion drawn from them is provisional in a way a conclusion from real material would not be.**

## How lines are classified

`run.mjs` reads each file's physical lines (split on `\n`). A line at or under 20 code points is
treated as short spoken-language material; anything longer is long prose (see the threshold's
rationale in `run.mjs`, next to `SHORT_LINE_THRESHOLD`). There is no metadata to classify by — plain
text is all a pasted passage is — so line length is what the harness infers from.
