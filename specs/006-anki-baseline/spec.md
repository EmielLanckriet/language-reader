# Feature Specification: My Anki Words As A Starting Point

**Feature Branch**: `006-anki-baseline`

**Created**: 2026-09-26

**Status**: Draft

**Input**: User description: "Import the reader's Anki vocabulary as a baseline of word states, so the Reader already knows which words they know before they start reading. Source: the reader's live Anki profile ("User 2" on the laptop, synced nightly), note type "HSK", the Chinese word in the "Simplified" field, 5,000 notes with one card each, in decks "Mandarin: Vocabulary::HSK" and "Try hard". The collection uses FSRS: 2,128 cards store stability (days until recall drops to 90%) and difficulty; 2,872 cards were never studied; 4 are in (re)learning; 2 are suspended; 169 have lapsed 3+ times; review intervals: <7 d 44, 7-20 d 133, 21-89 d 612, 90-364 d 448, 365+ d 887. The reader explicitly does NOT want a plain known/learning split: the Reader's word states should reflect the way Anki already represents the card (its strength), not collapse it. […] Imported judgments must be told apart from the reader's own (provenance "anki") and must never overwrite a judgment the reader made themselves in Reader; a later re-import must be possible without duplicating or losing anything, and it must be possible to undo an import. […] Words in Anki that do not occur in any document yet must still get a state. This touches earned data (the event log and word states), the project's irreversible surface."

## Why This Slice Exists

The reader is about to use the app daily, and every page of it currently treats all 2,128 words
they have already studied in Anki as unknown. That drowns the words that are actually new, which
are the ones worth looking at, and it makes the reader re-mark by hand what Anki already knows.

Anki knows more than "known" or "not known". For each card it records how strong the memory is:
FSRS stability, the days until the chance of recall falls to 90%. The reader's cards range from
hours to years. Collapsing that into two states throws away exactly the information that tells a
fragile word from a solid one, so this slice carries Anki's strength across, not a verdict.

It touches the reader's earned data (ADR-0003): the history of judgments and the states projected
from it. Anki's collection is never written to (Principle III).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - My Anki words are already marked when I start reading (Priority: P1)

The reader brings their Anki vocabulary over once. From then on, opening any document or video
shows the words they have studied in Anki marked according to how well Anki says they know them,
and only the genuinely unfamiliar words stand out.

**Why this priority**: It is the whole point: a useful first page instead of a page full of words
that look new and are not.

**Independent Test**: Import from a copy of the reader's collection. Open a document containing
a word Anki holds as long-term (e.g. 将来), one held as fragile, and one not in Anki at all. The
first two show their Anki strength, differently from each other; the third shows as never judged.

**Acceptance Scenarios**:

1. **Given** a library with no marks, **When** the reader imports their Anki words, **Then** every
   studied Anki word has a state reflecting its Anki strength, and the import reports how many
   words it marked, by strength.
2. **Given** an Anki word that appears in no document yet, **When** a document containing it is
   later added, **Then** it shows its imported state at once.
3. **Given** a word the reader marked themselves in Reader, **When** they import, **Then** their own
   mark is kept, not replaced by Anki's.

---

### User Story 2 - Anki keeps changing, and the Reader keeps up (Priority: P2)

The reader keeps reviewing in Anki. Importing again later brings the Reader up to date: words that
got stronger or weaker change, newly studied words appear, and nothing is duplicated or lost.

**Why this priority**: A one-off import goes stale within weeks, as the reader's own collection
shows: its nightly sync changes it every day.

**Independent Test**: Import, change a card's strength in the source copy, import again. Only that
word's state changes, and the history shows one new entry for it.

**Acceptance Scenarios**:

1. **Given** an earlier import, **When** the same collection is imported again unchanged, **Then**
   nothing is written.
2. **Given** a word whose Anki strength changed, **When** re-imported, **Then** its state follows
   Anki, unless the reader has marked it themselves in Reader since.

---

### User Story 3 - I can take an import back (Priority: P3)

If an import turns out wrong (the wrong profile, or a mapping the reader does not like), the reader
can undo it, and every word it marked returns to what it was before, with the reader's own marks
untouched.

**Why this priority**: Importing thousands of judgments at once is the largest single change the
reader can make to their earned data. It must not be a one-way door.

**Independent Test**: Mark two words by hand, import, undo the import. The two hand marks are as
they were, and every word only Anki had marked is unmarked again.

**Acceptance Scenarios**:

1. **Given** an import, **When** the reader undoes it, **Then** every word whose state came from that
   import returns to its state before it, and the history records the undo rather than erasing the
   import.

### Edge Cases

- The same Chinese word on two notes (e.g. in both decks): one state, the stronger of the two.
- A suspended card (2 today): imported like any other card at its last known strength, since
  suspending says "stop reviewing", not "I forgot it".
- A card in (re)learning: imported at the weakest strength, since Anki is actively re-teaching it.
- A field with markup or extra text (HTML, a second form in brackets): only the bare Chinese word is
  used; a note whose word cannot be read is skipped and counted in the report.
- A word the Reader segments differently from Anki (Anki's word is split into two tokens in a
  document): the Anki word still gets its state; it shows wherever the Reader finds that word whole.
- The copy is of the wrong or a stale profile: the import says which profile and when it was last
  changed, before anything is written.
- Importing while another copy of the app holds the write lease: refused, as any change is.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The reader MUST be able to bring their studied Anki words into the Reader from the
  laptop to the phone without typing any words by hand.
- **FR-002**: The Anki collection MUST NOT be written to or locked; only a copy of it is read
  (Principle III, ADR-0006).
- **FR-003**: Each imported word's state MUST be one of four Anki levels, named after Anki's own
  vocabulary and kept apart from the reader's own four states (`learning` already means the reader's
  judgment): **Anki: learning** (a card in (re)learning, or strength under 1 week), **Anki: young**
  (1–3 weeks), **Anki: mature** (3 weeks to 1 year), **Anki: long-term** (over a year). Strength is
  the card's FSRS stability, or Anki's interval where a card has none. The level is fixed at the
  moment of the import; the strength itself is kept with the judgment, so a finer display (today's
  chance of recall) stays possible later.
- **FR-004**: Every imported judgment MUST carry the provenance `anki`, and the strength it came
  from, so it can always be told apart from the reader's own.
- **FR-005**: An import MUST NOT replace or hide a judgment the reader made themselves in Reader,
  now or later.
- **FR-006**: An import MUST be all-or-nothing: either every word it marks is recorded, or none is.
- **FR-007**: Re-importing MUST record a change only for words whose Anki strength differs from what
  the Reader last imported for them, and nothing for an unchanged collection.
- **FR-008**: An import MUST be undoable as a whole. Undoing MUST return each word it marked to its
  state before the import, by recording the reversal, never by deleting history.
- **FR-009**: A word from Anki MUST get its state whether or not it occurs in any document yet.
- **FR-010**: Before writing, the import MUST show the reader what it is about to do: which profile,
  when it was last changed, and how many words at each strength.
- **FR-011**: Words Anki holds but has never taught (never-studied cards, 2,872 today) MUST be left
  unmarked: to the reader they are new, and they look new.
- **FR-012**: The Reader MUST show imported states distinguishably by strength wherever words are
  shown (documents and the video stage), and a word's details MUST say that the state came from
  Anki and when.

### Key Entities *(include if feature involves data)*

- **Anki word**: a Chinese word from the reader's collection, with its card's strength (FSRS
  stability, or Anki's own interval where there is none), its learning state (new, learning,
  review, relearning), whether it is suspended, and its lapses.
- **Import**: one bringing-over of a set of Anki words at a moment, from a named profile. The unit
  that is reported, re-imported against, and undone.
- **Imported judgment**: an entry in the reader's history with provenance `anki`, naming the import
  and the strength it came from. Like every judgment, it becomes the word's state only through the
  history.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After one import from the reader's current collection, all 2,128 studied words have an
  Anki-derived state, and a typical page of the reader's videos shows at least half of its words as
  already known from Anki.
- **SC-002**: The whole import, from starting on the laptop to states showing on the phone, takes the
  reader under 2 minutes and no typing.
- **SC-003**: Re-importing an unchanged collection records zero changes; re-importing after a week
  of reviews records exactly one change per word whose strength moved.
- **SC-004**: Undoing an import leaves every hand-made mark identical to before and every word only
  that import had marked unmarked.
- **SC-005**: No byte of the Anki collection changes, verified by comparing it before and after.

## Assumptions

- The reader's live profile is "User 2" (updated nightly; "User 1" is from 2025). The note type is
  "HSK" and the word is its "Simplified" field.
- Strength is read from the collection copy as of its last sync; the reader syncs Anki on the laptop
  (the nightly job already does) before importing. A stale copy is the reader's to notice from FR-010.
- The Reader's states are free text (FR-006a of spec 001), so strength levels can be states of their
  own without a change to how states are stored.
- Moving the words from laptop to phone reuses the Termux link the app already has (ADR-0017,
  ADR-0022), or a file; either satisfies FR-001.
- A later sync that writes to Anki (proposing new notes) is out of scope; this slice only reads.

## Clarifications

### Session 2026-09-26

- Q: How does Anki's strength become the Reader's states? → A: Anki's own levels as four states of
  their own (learning, young, mature, long-term, by stability: under 1 week, 1–3 weeks, 3 weeks to
  1 year, over a year), fixed at each import, with the stability kept for a finer display later.
  Today's cards, by stability: 52 learning, 137 young, 1,039 mature, 900 long-term (2,128).
- Q: What about the 2,872 cards Anki has never taught? → A: Left unmarked.
