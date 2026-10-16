# ADR-0042: What a card gave before its grade
Status: Accepted. Date: 2026-10-16. Issue #37; for the fit, #18 and #29.

Every new review, in Cards and in a hardcore drill, records two facts in its `detail`:

- `sentenceShown`: whether an example sentence was on the card's front.
- `heard`: each recording played, with the face it was **first** played on:
  `{ sentence?: 'front' | 'back', word?: 'front' | 'back' }`, `front` meaning before Show answer.
  Written as `{}` when nothing was played.

Memory does not use them. They reach the learning-data export unchanged (a review's `detail` is
already exported), so the fit can weigh a success that the sentence helped.

Why: the reader often grades Hard when the example sentence got them to the answer (2026-10-12).
The front shows the sentence's characters and pinyin whenever there is one, so the facts that vary
are whether its audio was played and when: before the answer it may have produced it, after only
confirmed it. The word's audio is the same kind of help and costs nothing more to record. `{}` is
written rather than nothing so that "nothing played" differs from reviews recorded before this,
which say nothing either way. `sentenceShown` is recorded rather than inferred from the layout so
that a later layout (a sentence hidden until asked for) does not rewrite what earlier reviews mean.

How: `domain/card-help.ts` (`CardHelp`, `heardOn`); `CardFace.svelte` tracks plays and hands the
help to `ongrade`; Cards passes it to `recordReview` (a new last argument, through the worker), and
the drill spreads it into its review's detail. No migration: JSON detail. Tests:
`tests/storage/card-help.test.ts`; browser `cardaudio` reads it back from the export.

Not recorded: how often or how long a recording played (first face is what decides "helped");
the English, which only shows after Show answer. Rejected: a separate encounter per play (more
rows to keep in step with the grade, for no question that needs them yet).
