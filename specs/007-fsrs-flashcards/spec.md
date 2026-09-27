# Feature Specification: Flashcards That Know What I Read And Watched

**Feature Branch**: `007-fsrs-flashcards`

**Created**: 2026-09-27

**Status**: Draft

**Input**: User description: "In-app flashcards with an FSRS scheduler fed by reading and viewing
encounters. Reviewing moves from Anki into the Reader; Anki becomes a one-time seed: its imported
stability is a word's starting memory state, and Anki's collection is still never written to. […]
Scope: (1) encounter event logging — lookups, 'I knew it' checks, line replays, slowed playback,
line translations opened, lines skipped, a per-session attention answer — with modality, document,
line, creator and playback speed; (2) a rudimentary FSRS scheduler per (word, skill), derived by
replaying reviews and encounters through a changeable mapping, seeded from Anki; (3) word colouring
by current recall probability; (4) a flashcard page with reading cards in a context sentence from
the reader's library, graded Again/Hard/Good/Easy, cards created from lookups with a daily cap and
priority by library frequency. Out of scope: listening cards (needs a brainstorm), fitting
parameters or encounter weights, difficulty priors, feature-based memory models."

## Why This Slice Exists

Two things, one of which is urgent.

**Encounters are being lost every day.** The anticipated-changes register has said since before
slice 0 that recording an encounter is earned data that no fold can recover, and it has been
deferred since 2026-09-02. The reader now reads and watches daily. Every word they look up, every
line they replay, every stretch they listen to without understanding goes unrecorded, and that is
exactly the evidence a scheduler that knows what the reader has met would need.

**The reader wants to review in the Reader, not in Anki.** Decided on 2026-09-27: reviewing moves
into the app, so that what happens while reading and watching can shape the schedule, which Anki's
scheduler cannot be told. Anki's collection becomes a starting point: each word's Anki strength is
its initial memory, and Anki is still never written to.

The scheduler in this slice is deliberately rough. How much an encounter should count is a guess
today, and it is kept as a guess that can be changed: the memory states are recomputed from the
recorded events, so a better rule later costs a recompute and loses nothing. Only the events are
permanent.

**Out of scope**, recorded as foreseen: listening cards (a clip from the reader's own media
containing the word, a different clip each review; needs a brainstorm before specifying); fitting
the scheduler's parameters or the encounter weights to the reader's own history (needs months of
reviews first); library frequency and context diversity as difficulty priors; feature-based memory
models. Creator and playback speed are recorded now but used by nothing yet.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - What I look up and replay is remembered (Priority: P1)

The reader watches a video or reads a text as they do today. Everything that says something about
what they know is recorded as it happens: which stretch they read or played, which words they looked
up, which lines they replayed or opened the translation of, which parts they skipped, and at what
speed. When they finish, one question asks how attentively they followed it.

**Why this priority**: It is the only part that loses something for every day it is not built. It
is also the input for everything else in this slice.

**Independent Test**: Watch two minutes of a video: look up two words, answer "I knew it" on a third,
replay one line, open one line's translation, skip thirty seconds, change speed, answer the attention
question. The reader's history then shows each of these, in order, with the video, the line, the
speed and whether the line's text was showing; nothing else in the app looks any different.

**Acceptance Scenarios**:

1. **Given** a video playing, **When** the reader taps a word and reads its meaning, **Then** a lookup
   is recorded for that word, with the video, the line, the moment in the video, the playback speed,
   and that it happened while listening.
2. **Given** a lookup open, **When** the reader answers "I knew it", **Then** it is recorded as a check,
   distinct from a lookup of a word they did not know.
3. **Given** a text, **When** the reader scrolls through it, **Then** the stretches that were on screen
   are recorded as read, as a few ranges per session, not one entry per word.
4. **Given** a video, **When** the reader seeks past a minute of it, **Then** that minute is not recorded
   as played, so it is distinguishable from the stretches that were.
5. **Given** the end of a session (leaving the video or text), **When** the attention question is shown,
   **Then** the answer is recorded with the session; **When** it is dismissed, **Then** the session
   records that no answer was given, and the app's own estimate is kept apart from the reader's answer.
6. **Given** the app is closed or killed mid-session, **When** it is opened again, **Then** everything up
   to the last few seconds before it closed is in the history.

---

### User Story 2 - My words are coloured by how well I still know them (Priority: P2)

Every word the Reader has a memory of (from Anki, from flashcard reviews, or from lookups) is
coloured by today's chance that the reader recalls it. A word Anki held strongly years ago, or one
just reviewed, looks solid. A word looked up last week and not seen since looks like it is fading.

**Why this priority**: It is how the scheduler's view is visible on every page, and it replaces the
four fixed Anki levels, which only change at the next import.

**Independent Test**: Seed from Anki. Open a document with a long-term Anki word, a word reviewed
weeks ago with low stability, and a word never judged. They show three visibly different colours.
Look up the long-term word. It now shows as weakly known, and it shows the same way in every other
document.

**Acceptance Scenarios**:

1. **Given** a word with a memory state, **When** any page shows it, **Then** its colour reflects its
   chance of recall today, in at least four visibly distinct bands.
2. **Given** a word looked up, **When** the reader returns to any page containing it, **Then** its colour
   already reflects the lookup.
3. **Given** a word marked ignored or known by hand and never looked up since, **When** a page shows it,
   **Then** it shows as it does today.

---

### User Story 3 - I review my words in the Reader (Priority: P3)

A flashcard page shows the reader today's due words, and new words drawn from what they recently
looked up. Each card shows the word in a sentence from the reader's own library. Tapping reveals the
pinyin, the meaning, and the sentence's translation; the reader grades their recall Again, Hard,
Good or Easy, and the next card appears.

**Why this priority**: It completes the move from Anki. It depends on the memory states of story 2,
and on the lookups of story 1 for its new cards.

**Independent Test**: Seed from Anki and look up three new words while reading. Open the flashcard
page. The due Anki words and up to the day's cap of new words are offered. Grade a card Again; it
comes back later in the session. Grade one Good; it is not offered again today, and its colour
elsewhere shows the review.

**Acceptance Scenarios**:

1. **Given** words due today, **When** the reader opens the flashcard page, **Then** it says how many are
   due and how many new, and shows the first card with the word in context.
2. **Given** a card shown, **When** the reader reveals it, **Then** the pinyin, the meaning and the
   sentence's translation are shown (the translation when one is available).
3. **Given** a revealed card, **When** the reader grades it, **Then** the grade is recorded in the history,
   and the word's next due date follows from it.
4. **Given** twelve words looked up today and a cap of ten new cards, **When** the page is opened, **Then**
   ten are introduced, the most frequent in the reader's library first, and two wait for tomorrow.
5. **Given** a word reviewed more than once, **When** it is shown again, **Then** the sentence differs from
   the last one where the library has another.

---

### Edge Cases

- The same word looked up five times in one video: one piece of evidence for the scheduler, not
  five lapses. All five lookups are still recorded.
- A word looked up in a video with its line's text showing: the reader saw the characters and heard
  the word. Both facts are recorded; which skill the lookup counts against is the mapping's decision.
- A lookup that turns out to be a check ("I knew it"): it is not treated as a failure.
- A word the Reader segments differently from Anki, or two senses under one written form (花 as
  *flower* and *to spend*): one memory per word as the Reader currently segments it. The occurrence
  is recorded, so a later sense split can redistribute the history.
- A word re-segmented after events were recorded (the background analyzer upgrade): events are
  anchored on the document and its offsets, so they follow the new segmentation instead of pointing
  at a lexeme that no longer occurs there.
- A later Anki import, after in-app reviews have started: it does not override a word the Reader
  already has its own reviews for.
- A word marked ignored: never a card, whatever its lookups.
- No translation available for a card's sentence (Termux not running): the card is shown without
  it, not held back.
- Two devices, or two tabs: events carry the device and its sequence number, as every history entry
  does, and only the writer holding the lease writes.
- A session with no lookups and the attention question dismissed: kept. Reading without tapping is
  also evidence.

## Requirements *(mandatory)*

### Functional Requirements

**Recording encounters (earned data)**

- **FR-001**: The Reader MUST record, as they happen and append-only, these encounter events: a
  **lookup** (a word's meaning shown on tap); a **check** (a lookup answered "I knew it"); a **line
  replay**, including a replay that went to the previous line; a **line translation opened**; a
  **playback setting changed** (speed, stop-after-each-line); and the **stretches read or played**
  in a session.
- **FR-002**: Stretches MUST be recorded as ranges of the document per session (a few per session),
  not as one event per word shown. Which words were encountered is derived later by intersecting the
  ranges with the tokens, so a re-segmentation corrects the history (register: "Recording that a word
  was encountered").
- **FR-003**: Parts of a video or audio skipped or sought past MUST be distinguishable from parts
  played, by being absent from the played ranges.
- **FR-004**: Every encounter event MUST record the document, the position in it (offsets, and the
  line and the time in the media where there is one), the modality (reading a text, or watching or
  listening to media), whether the line's text was visible, the playback speed, the device and its
  sequence number, and the moment.
- **FR-005**: Media MUST record its creator (the channel or speaker the source names) when it is
  added, where the source names one. Existing media without it keeps working, with the creator
  unknown.
- **FR-006**: At the end of a session the Reader MUST offer one attention question with three
  answers ("I tapped everything I didn't know", "some", "I just listened / read"), dismissable. The
  reader's answer, or its absence, MUST be recorded with the session. An estimate the app makes
  itself MUST be derived, never stored as though the reader had answered.
- **FR-007**: Flashcard reviews MUST be recorded as events in the same history: the word, the skill,
  the grade, the sentence shown, and the moment.
- **FR-008**: Encounter events MUST be recorded as facts about what happened, never as conclusions
  ("lookup", not "forgotten"), so a different reading of them later needs no migration.
- **FR-009**: Recording MUST lose at most the last few seconds of a session when the app is closed or
  killed.
- **FR-010**: Encounter events MUST be included in the copies of earned data already sent to Termux
  (ADR-0020) and in restoring from them.

**Memory and scheduling (derived data)**

- **FR-011**: The Reader MUST keep one memory state per (word, skill), with the skills **reading**
  and **listening**, each computed by replaying that word's history (flashcard reviews and encounter
  events) through a spaced-repetition model with default parameters.
- **FR-012**: How each kind of encounter counts as evidence MUST be one named, versioned rule. Its
  first version: a lookup counts as a failure against both skills; a check counts as a weak success;
  a word read or heard in a session the reader answered as attentive, without a lookup, counts as a
  weak success for words that already have a memory state, at most once per word per day; lookups of
  the same word in one session count once; anything the reader did not answer counts for nothing.
  Every memory state MUST record which version of the rule produced it.
- **FR-013**: Changing the rule MUST need only a recompute from the history, never a change to
  recorded events. The recompute MUST not keep the reader waiting: states from the previous rule
  stay usable until the new ones replace them.
- **FR-014**: Words from an Anki import MUST start with a reading memory state from their Anki
  strength and the date of their last Anki review. The laptop's export therefore also MUST carry
  each card's last review date and difficulty; for an older export without it, the import's date is
  used and this is recorded.
- **FR-015**: Once a word has in-app reviews, a later Anki import MUST NOT change its schedule.

**Colouring**

- **FR-016**: Wherever words are shown (documents and the video stage), a word with a memory state
  MUST be coloured by its chance of recall today, in at least four distinguishable bands, replacing
  the four Anki levels as the display. A word without one MUST show its hand-marked state, or none,
  as today.
- **FR-017**: A new lookup or review MUST show in the word's colour everywhere by the next time a page
  showing it is drawn.
- **FR-018**: A word's details MUST show its reading and listening memory in plain words (e.g. "reading:
  92% today, next review in 12 days"), and where it came from (Anki, reviews, lookups).

**Flashcards**

- **FR-019**: A flashcard page MUST offer the words whose reading memory is due today, then new words,
  and say how many of each before the first card.
- **FR-020**: A word MUST become a card through a card-creating event: a lookup, an Anki import, or
  a hand mark of learning. Which events create cards is part of the named rule of FR-012, so a new
  way (e.g. words in skipped lines) is a rule change, not a migration. A word marked ignored is never
  a card. Cards never reviewed in the Reader are shown for the first time up to a daily cap (default
  10, changeable), most frequent in the reader's library first; the rest wait, and are still cards.
- **FR-021**: A reading card MUST show the word highlighted in a sentence from the reader's library,
  preferably the one it was looked up in the first time, and a different one on later reviews where
  the library has another. The reveal MUST show the pinyin, the meaning, and the sentence's
  translation when one is available or can be made.
- **FR-022**: The reader MUST grade each card Again, Hard, Good or Easy. A card graded Again MUST come
  back in the same session.
- **FR-023**: Reviewing MUST work offline, with nothing from Termux except the optional translation.
- **FR-024**: A word the reader marks ignored MUST stop being offered as a card; its history is kept.

### Key Entities *(include if feature involves data)*

- **Session** (earned): one sitting with one document or medium, from opening to leaving. It holds
  the stretches read or played, the modality, the playback speed, and the attention answer or its
  absence.
- **Encounter event** (earned): one thing that happened in a session: a lookup, a check, a replay, a
  translation opened, a setting changed. Anchored on the document and its offsets, never only on a
  word.
- **Review** (earned): one flashcard grade: word, skill, grade, the sentence shown, the moment.
- **Creator** (earned, from the source): who made a medium, as the source names them.
- **Memory state** (derived): for one word and one skill: stability, difficulty, last evidence, next
  due, and the version of the evidence rule that produced it. Recomputable from the three above plus
  the Anki seed.
- **Evidence rule** (code, versioned): how each kind of event counts. Its version is recorded with
  every memory state.
- **Card** (derived): a word being reviewed in a skill, created by a card-creating event under the
  rule. Reading only in this slice.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In a scripted two-minute session with every kind of event in it, 100% of the events
  appear in the history with their document, position, modality and speed, and none that did not
  happen appear.
- **SC-002**: Killing the app mid-session loses no event more than 5 seconds old.
- **SC-003**: After seeding from Anki, all 2,128 studied words have a reading memory state, and the
  number due today is within 20% of what Anki itself shows as due on the same day.
- **SC-004**: A lookup shows in the word's colour on every page within one second, with no reload.
- **SC-005**: The flashcard page shows the next card within half a second of a grade, on the phone.
- **SC-006**: Recomputing every memory state from the history after a rule change takes under 30
  seconds on the phone, and the colours stay usable throughout.
- **SC-007**: Recomputing from the history, from an empty set of memory states, reproduces exactly the
  memory states that were built up incrementally.
- **SC-008**: The reader does one week of daily reviews in the Reader and does not open Anki to review.

## Assumptions

- **Reviewing moves wholly into the Reader** (reader's decision, 2026-09-27), which means giving up
  AnkiDroid's review screen and the nightly `sentencegen` enrichment for review (register: "Build our
  own FSRS scheduler"). This amends Constitution Principle III: Anki is no longer the scheduler,
  and is still never written to. The amendment and its ADR are made during planning.
- **Evidence weights are guesses.** FR-012's first rule is not fitted to anything. It is kept rough
  on purpose until months of reviews exist to fit it against; ADR-0003 makes that cheap.
- **Anki's cards are recognition cards**: Chinese to meaning. They seed the reading skill only; the
  listening skill starts from what the reader meets in media.
- **Hand marks keep their meaning.** Ignored words are never cards; a word marked known by hand gets
  no card unless the reader later looks it up; a word marked learning by hand becomes a card.
- **The default spaced-repetition parameters** are used (target recall 90%). Fitting them is out of
  scope.
- **The meaning** on a card is the dictionary's (CC-CEDICT, as the tap menu shows today); the
  translation is the existing line translation (ADR-0021), shown when available.
- **One reader.** Events carry the owner, as every history entry does.
- **Listening cards are out of this slice**, but listening memory is kept from now on, so when they
  arrive the reader's listening history is already there.
