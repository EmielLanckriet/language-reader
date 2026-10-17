# Research: Hardcore mode

Gathered 2026-10-12/13 from the code (memory, repository, Cards, player) and two planning answers
from the reader (spec Clarifications, session 2026-10-13).

## R1. Where a hardcore session's records live

Decision: a hardcore session is a `session` row with modality `hardcore` for its document. Its
encounters: one `hardcore-plan` (the options and every part's lines and words), `hardcore-step`
at each step's start and end, and the drill's `review`s. No migration: `session.modality` and
`encounter.kind` are free text and `detail` is JSON (003-encounters.sql), and backups carry
unknown kinds (`validateEncounter` lets them pass).
Rationale: a session row gives the reviews a session id, so withdrawing the document
(`withdrawDocument`) takes them back with everything else, and every query that already excludes
withdrawn sessions does so for them too. `studyOverview` lists a session only with study time,
playback or an answer, so a hardcore session never appears on Progress or as Continue.
Alternatives: reviews with no session and the hardcore id in `detail` (as Cards: not
withdrawable, and every grouping would need a JSON lookup); a new table (a migration of earned
data for what free-text kinds already hold).

## R2. The review's shape

Decision: a drill grade is `kind: 'review'` exactly as Cards writes it (`recordReview`,
`repository.ts:1185`): the word's occurrence as the range, `detail.skill: 'reading'`, the grade.
Added: `detail.hardcore: { part }` (the label) and `detail.line: [from, to]`, the code-point range
of the line shown. The session id is the hardcore session's.
Rationale: every review keeps one meaning for its range (the occurrence the card showed), so
`cardSentence`'s rotation and the fit read it as before; the line is what `evidence-4` needs (R4).
The fit (spec 013) reads reviews from the word's history, so drill grades enter it untouched
(FR-013, clarified).
Alternatives: the line as the range (would make a review's range mean two things); a new kind
`drill` (every review query — fit, study days, history — would need it added; the label opts out
only where the rule differs).

## R3. The memory rule: what a hardcore review does not do, and the 14-day route

`evidenceFor`/`memoryOf` (`src/lib/domain/memory.ts:212-509`) let any review: make the word a
card (`card`), make it active (`reviewed`, read by `isActive` in `queue.ts:20`), and end a
set-aside mark (`reviewedSince`). An Anki import after any in-app review is ignored.
Decision:
- A hardcore review counts as evidence like any review (`fold` unchanged) and still stops later
  Anki imports (it is an in-app review: Reader owns the schedule from then on).
- It does not set `card`, `reviewed` or end set-aside.
- **Drilled in**: from the word's first hardcore review on, the reading fold checks stability after
  every evidence; the first time it is ≥ `DRILLED_IN_DAYS` (14), the word is drilled in for good.
  A drilled-in word is stored as a reviewed card (`card` 1, `reviewed` 1), not set aside: it has
  its own schedule, which is what `reviewed` means to the queue. No new column code.
- Rule key: `ACTIVATION` becomes `known-2+drill-14`, so the threshold is in the key and changing
  it recomputes; the background sweep recomputes every memory once (as ADR-0039's `+known-2` did).
Rationale: FR-014/FR-015 and the reader's answer (checked from the first drill on). Sticky because
every other way into Cards is.
Alternatives: a new `memory.card` code 4 for drilled-in words (one more case in every reader of
the column for no difference in behaviour); checking only right after a drill (rejected by the
reader); no key change because no stored memory has a hardcore review (ADR-0040's precedent) —
rejected, the constant must be in the key for the anticipated threshold change.

## R4. A drilled line counts as seen before (`evidence-4`)

`wordHistory` (`repository.ts:1462-1500`) gives an exposure `rewatchDays` from the earlier
viewings of the same occurrence's sentence **in another session** (read/played rows).
Decision: viewings also include hardcore reviews whose `detail.line` covers the occurrence, at the
review's time. The drill is its own session, so watching after it is always "another session",
and a drilled line watched an hour later gets `rewatchDays ≈ 0.04`: counted at about half
(`REWATCH`), and not as a fresh context for `known`. Drill lines are viewings only, never
exposures (they credit nothing themselves). `RULE` stays `evidence-4`: the rule is unchanged,
its input gains a source; the key change of R3 recomputes anyway.
Alternatives: counting Cards examples as viewings too (a change to Cards, not asked for; noted as
an anticipated change); a separate drilled-line discount (a new fitted parameter without data).

## R5. The new-word budget

`cardsToday` counts first reviews today as `MIN(at)` over all reviews per word
(`repository.ts:2076`). Decision: over reviews without `hardcore`. A word drilled yesterday and
picked by the budget today counts on its first Cards review (FR-015).

## R6. Parts and words (pure, `src/lib/domain/hardcore.ts`)

Lines are the `\n` stretches of the document (`lineRangesOf`, `helped.ts:51`); line i of a video
is cue i. Decision:
- The repository gives, for the document's words: class (new, due, not yet active, set aside,
  excluded), the shares' known flag (`shares.ts:34`), general-frequency rank, and the words passed
  in a drill today (day-end hour as the week card).
- Filters in order: occurrences ≥ x; rank < y; coverage z% (drillable words by fragment
  frequency, desc, until known running words + kept words' occurrences ≥ z% of running words).
- Cut by load, greedy over lines, counting each word only at its first line: cut **before** a line
  when the part holds ≥ N/2 and the line would take it over 1.5 N; cut **after** a line once it
  holds ≥ N; a last part under N/2 joins the previous one when the sum stays ≤ 1.5 N.
- A word's card line is its first line in the part.
- The plan keeps every part's words (`hardcore-plan`): a drilled due word stops being due, so
  recomputing the parts later would shift them. Words passed today are skipped when a drill
  starts, not removed from the plan, so the parts and their "done today" marks stay put.
  (Superseded 2026-10-17, issue #46: words are classed by memory alone, and a drill re-classes
  its part's words when it starts; "passed today" and "done today" are gone.)
Properties (test-first, derived data): parts are consecutive and tile the fragment; every kept
word is in exactly one part, the first containing it; sizes as above; filters are monotone (a
stricter value never adds a word).

## R7. Watching a part

The player has no end time and no way back (`read/[id]/+page.svelte:499`, `MediaReader.svelte`);
"Stop after each line" (`stopAtLineEnd`, checked every frame) is the precedent.
Decision: `/read/[id]?t=<start>&until=<end>&back=<path>&step=<session>.<part>.<step>`.
`MediaReader` pauses at `until` with the same per-frame check and shows **Back to the session**
and **Again**; back navigates to `back`, through the existing "Before you go" sheet after 10 s
(the reader's answer: every watch step). For a text, `?from=<line>&to=<line>&back=` renders only
those lines with **Done**. The recorder writes one `hardcore-watch` encounter
`{session, part, step}` in the player's own session, linking it to the step (FR-016a).

## R8. The card

The faces, audio and Retire live inline in `cards/+page.svelte`, depending only on
`current {lexemeId, word, sentence, english}`. Decision: extract `CardFace.svelte` (faces,
example audio, retire/undo, grade buttons emitting the grade) used by Cards and the drill. The
drill builds a `CardSentence` for the line (`source: 'reader'`, `lineText`, `lineFrom`, `line`),
so `timedExample` (`card-audio.ts:5`) cuts the cue as on Cards. Browser scenarios `cards`,
`cardaudio`, `cardlayout` guard the extraction.

## R9. In-drill order and steps

Pure: a drill queue of word ids; Again moves the card 3 places back (to the end when fewer remain);
any other grade removes it; done when empty. Session progress is rebuilt from the records: the next
step is the first (part, step) of the plan without a `hardcore-step` end, so returning from the
player continues. English preview: the video's own English per line (`englishFor`); a text has
none in Reader, so the quick translator, as Cards does.

## R10. Cost

Planning a 650-line film: one pass over its ~15,000 tokens and one memory query for its words;
expected well under a second on the phone, to be measured before claiming it. The rewatch query
gains one indexed join per word recompute (`encounter_document`). The one-time recompute of R3 is
the existing background sweep.
