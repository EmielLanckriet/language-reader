# Feature Specification: Hardcore mode — drill a fragment's words around watching it

Created: 2026-10-12. Status: specified. Branch: main. Issue #36.
Input: go hard on one video or text: drill the words a fragment needs as cards with sentences from
that content, around watching it. Brainstormed with the reader on 2026-10-12; the issue holds the
reasoning behind the 14-day threshold. Started from the document page (#31).

## Clarifications

### Session 2026-10-12

- Q: Are a session's options tied to the document? → A: No. They are chosen every time a session is started; one document can be gone through hardcore in different ways at different times.
- Q: Which words count as "not yet active"? → A: Every word with memory that is not an active card, tapped or not (not only ADR-0039's tapped candidates).
- Q: Should the session itself be recorded, beyond the labelled grades? → A: Yes: a session start with its options and parts, and each step's start and end, so #29 can relate steps to outcomes.
- Q: Once a drilled word becomes active at 14 days, does it stay active if its stability drops? → A: Yes, permanently (unless retired), like every other way into Cards.
- Q: Where does the fragment start by default? → A: The reader chooses at the start: from the beginning, or continue from where they last stopped watching (as the document page's Continue); a hand-picked from–to range stays possible.
- Q: Do drill grades count in the personal FSRS parameter fit (spec 013)? → A: Yes, like any review: FSRS should know the word was just seen; the watching and preview before the drill are in the history it replays.

### Session 2026-10-13 (raised in planning)

- Q: Leaving a watch step after 10 s: ask "Before you go" as the player does? → A: Yes, after every watch step, as for any watching.
- Q: When is the 14-day stability checked? → A: After every piece of evidence from the word's first hardcore review on, so reading and watching can carry a drilled word there too.

## One engine, not modes

A session is a fragment of one document, cut into one or more **parts**. Every part runs the same
chosen **steps** in one fixed order: English preview → watch first → drill → watch after. Then the
session offers the next part. Every way of using it is a choice of options for this one loop:

- Go hard on a fragment: one part, steps preview + watch first + drill + watch after.
- A whole movie in parts: cut by load into parts of about 20 drill words, part by part.
- Small fragments in turn (drill 1–2 minutes, watch them, next): cut by load with small parts
  (e.g. 5 words), steps drill + watch after.

## User Scenarios & Testing

### US1 — Drill a fragment's words with its own sentences (P1)
From a document's page the reader starts hardcore mode, picks a fragment (from the beginning,
continue where they stopped, or from–to), keeps the other defaults and drills. Each card shows a
word with a line of this fragment where it occurs, and that line's audio after reveal. Again puts the card back a few cards later; the
drill ends when every word has passed once.
Acceptance: the words drilled are exactly the fragment's drill words (FR-004–FR-007); every card's
sentence is a line of the fragment containing the word; a word graded Again comes back in the same
drill and the drill does not end until it is passed; each grade is recorded when given.
Independent test: a 90 s fixture document; start with defaults; drill to the end; the recorded
hardcore reviews match the grades given, one per grade.

### US2 — Drill grades shape memory without flooding Cards (P1)
Every drill grade updates the word's memory like a review. A word that was not an active card
before becomes one only when its stability reaches 14 days, so it reaches Cards already known.
Acceptance: after drilling a new word once (Good), it is not due on Cards and not counted in the
library's "due come up"; once its stability reaches 14 days (e.g. after further drills on later
days), it is an active card with its earned schedule; a tapped candidate stays a candidate for the
daily new-word budget throughout; a due active card graded in a drill gets its next due date from
that grade, as from Cards.
Independent test: replay a fixed history with hardcore reviews and check activation, candidacy and
due dates exactly (earned data, asserted exactly).

### US3 — Watch the fragment around the drill (P1)
With watch first and/or watch after chosen, the player plays exactly the part, from its first
line's start to its last line's end, stops there and returns to the session. For a text, the reader
shows the part to read and returns on "Done". With English preview chosen, the part's English lines
are shown first; for a video the reader may also play the part with English shown.
Acceptance: playback starts at the part's first line and stops within 0.5 s after its last line
ends; leaving the player early returns to the same step; watching is recorded as ordinary watching
or reading (it counts for memory as it does today).

### US4 — Cut a long fragment into parts by load (P2)
The reader picks "cut by load" with a part size of N drill words (default 20). The session lists
the parts with their line range and word count, marks the parts done today, and starts at the
first part not done or at any part the reader picks.
Acceptance: parts are consecutive line ranges covering the fragment; a word is drilled in the first
part it occurs in, never again in a later part of the same session; each part but possibly the last
has about N drill words (between N/2 and 1.5 N unless one line alone holds more).

### US5 — Choose which of the fragment's words to drill (P2)
Filters, all optional: occurs at least x times in the fragment; among the y most common words in
general Chinese; a coverage target z% (the fewest words that bring the fragment's known running
words to z%, most frequent in the fragment first). Order: most frequent in the fragment first
(default) or story order (first occurrence).
Acceptance: each filter removes exactly the words it should, in combination with the others; the
session start shows how many words will be drilled before starting.

### US6 — Come back to a part later the same day (P3)
Leaving mid-session loses no grade. Starting the same part again the same day skips the words
already passed in a drill today.
Acceptance: after passing 7 of 20 words and leaving, starting that part again drills the other 13.

## Edge Cases
- A part with no drill words: the drill step says so and the session moves on to the next step.
- A word occurring in several lines of a part: its card uses the first such line (story order).
- A line with no audio (a text document, or a video line without timing): the card shows the
  sentence without audio.
- A line with no English: the preview shows it without English, not hidden.
- Again on the last remaining card: it comes back at once.
- A word retired from a drill card (Retire, as on Cards) leaves the session and never returns to it.
- The same word graded on Cards and in a drill on the same day: both are reviews, in time order.
- A whole ~300-word movie in one part: allowed (the reader chooses), the start shows the count.
- The day boundary is the week card's day-end hour, not midnight.
- A document whose subtitles change after a session started: the session's lines are those of the
  document as it was when the session started; no earned data refers to a line by position alone.
- A drill on a word whose only memory is an Anki seed (set aside): the drill grade continues from
  its Anki memory, as a Reader review would.

## Requirements

### Session
- **FR-001** The document page offers hardcore mode for every video and text document.
- **FR-002** A session has a fragment (a range of consecutive lines) that the reader picks at
  the start as one of: from the beginning, continue (from the start of the line where they last
  stopped, as the document page's Continue; offered only when started and not finished), or a
  hand-picked from–to range. The first two run to the document's end. The fragment is
  cut into parts either not at all (one part) or by load (parts of about N drill words, default
  20, adjustable), and a set of steps from {English preview, watch first, drill, watch after}
  (default all four), always run in that order within a part.
- **FR-002a** The options are chosen at every start of a session; nothing ties them to the
  document, and parts done earlier with other options do not constrain a new session.
- **FR-003** After a part's last step the session offers the next part; the reader can also pick
  any part from the list or end the session.

### Which words
- **FR-004** The drillable words of a fragment are its Chinese words (lexemes, not punctuation,
  Latin text or numbers) that are new (no memory yet), due active cards, not yet active (every word
  with memory that is not an active card, tapped or not: tapped candidates and words met only
  untapped alike). Excluded: active cards not due, and words retired by hand. A set-aside word
  (ADR-0040 amendment) is classed like an active card: drillable when its memory, Anki history
  included, is due, excluded otherwise (issue #42; amended 2026-10-17: before, every set-aside word
  was drillable, so a word known for years in Anki was drilled as if new).
- **FR-005** Filters, each optional and combinable: at least x occurrences in the fragment; rank
  among the y most common words in general Chinese (the frequency list of ADR-0039); coverage
  target z%: walking the drillable words most frequent in the fragment first, keep adding words until
  the fragment's known running words plus those of the kept words reach z%, or none are left.
  "Known" is the library shares' known band.
- **FR-006** Order: most frequent in the fragment first (default; ties by first occurrence), or
  story order (first occurrence).
- **FR-007** When cut by load, a word belongs to the first part it occurs in; parts are cut at
  line boundaries so each holds about N of the filtered words.

### Drill
- **FR-008** A drill card has the same faces, grades and Retire action as the Cards screen. Its
  example sentence is the part's line where the word first occurs, with that line's audio after
  reveal (ADR-0035).
- **FR-009** Learning steps: a card graded Again comes back 3 cards later (or last when fewer
  remain); Hard, Good or Easy passes it. The drill ends when every word has passed once.
- **FR-010** Words already passed in a drill today are skipped when the part starts again.

### Watching
- **FR-011** Watch first and watch after play the part from its first line's start to its last
  line's end and stop there; for a text, the part is shown for reading with a Done action. Both
  are recorded as ordinary playback or reading, and leaving them asks "Before you go" as leaving
  any watching or reading does (after 10 s).
- **FR-012** English preview shows the part's English lines; for a video it also offers playing
  the part with English shown. English quality is out of scope.

### Memory (earned data)
- **FR-013** Every drill grade, including repeats after Again, is recorded at once as a review
  labelled **hardcore**, with the document and the line shown, and updates the word's memory as a
  review does (FSRS with same-day reviews, as Cards). They count in the personal FSRS parameter
  fit (spec 013) like any review; the watching and preview just before them are in the replayed
  history, so the fit sees how recently the word was met.
- **FR-014** A hardcore review does not by itself make a word active (unlike an ordinary review,
  ADR-0039) and does not end a set-aside mark (unlike ADR-0040's amendment). A word that was not
  active becomes active the first time its reading stability is at least 14 days at any point from
  its first hardcore review on (after a drill, a reading or a watching alike); it then stays active
  for good (unless retired), whatever its stability does later.
- **FR-015** A drill does not change whether a word is a new-word candidate, and hardcore reviews
  do not count against the daily new-word budget.
- **FR-016** A line shown on a drill card counts as a line seen before for `evidence-4`'s discount
  (ADR-0037 amendment) whenever the reader later reads or watches it.
- **FR-016a** The session itself is recorded as earned data when it happens: its start with the
  options (fragment, parts, steps, filters, order) and each step's start and end (part, step).
  Hardcore reviews and the watching or reading done in a step can be related to their session
  and step.
- **FR-017** Hardcore reviews count as study time and study days as Cards reviews do, survive a
  backup and restore, and are taken back when the reader withdraws the document's history
  (ADR-0030).
- **FR-018** Mobile layout, light/dark, touch operation for the session start, part list and drill.

## Key Entities
Hardcore review: a review (word, grade, time) labelled hardcore, with the document, the line shown,
and its session, part and step. Earned. Session options: fragment, part size, steps, filters and
order; chosen at every start, not tied to the document. Part: a range of lines and its drill words,
derived from the options and the document. Hardcore session record: the options and the parts' line
ranges of a started session, and the start and end of each step done in it. Earned (FR-016a).

## Success Criteria
1. From the document page, a session from the beginning or continuing, with the other options at
   their defaults, starts in at most 2 taps.
2. No word that was not active before a drill shows up as due on Cards, or in the library's due
   counts, until its stability reaches 14 days.
3. Replaying the same history twice gives the same memory, activation and due dates for every word
   (deterministic, as the existing replay).
4. A 20-word part with no Again takes no longer than grading 20 cards on Cards.
5. Watching a part stops within 0.5 s after its last line on the phone.
6. Hardcore reviews are separable from Cards reviews in the history, and every hardcore review and
   watched or read stretch done in a session can be traced to its session, part and step (#29).

## Assumptions
- "Passed today" counts drills in any document.
- Leaving a session ends it; there is no "resume this session". Starting again chooses options
  afresh, and FR-010 skips the words already passed today. A part is "done today" when all its
  drill words were passed today.
- English preview playback with English shown is recorded like any playback with English shown;
  existing rules decide how much it counts.

## Anticipated Changes
| Change | Plausibility | Retrofit cost | Action |
|---|---|---|---|
| Change the 14-day threshold (7, 30) | High | Cheap: derived by replay from labelled reviews | One named constant; rule key change recomputes |
| Turn word categories (new, due, not yet active, set aside) on and off | Medium | Cheap: a filter over derived data | Defer |
| A pre-reveal listening prompt on drill cards | Medium | Cheap if the shown line is recorded | Record the line (FR-013) |
| Record whether the example was played before the grade (#37) | High | Cheap: an extra review field | Defer to #37 |
| Drill across several documents (a playlist or a series) | Low | Cheap: parts are derived | Ignore |
| Drop filters the reader never uses | High | Cheap: UI and derived filtering only | Keep them independent |
