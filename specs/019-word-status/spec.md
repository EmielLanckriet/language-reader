# Feature Specification: Word status — retired, active, ignored

**Created**: 2026-10-19 · **Status**: Draft · **Input**: decided with the reader 2026-10-19, after
the explanation of the scheduler showed card rules from older decisions still in force (known
words, Anki seeds active whatever their stability, `learning` marks making candidates, `ignored`
dropping a word's evidence). Amends ADR-0039, ADR-0040 and ADR-0041.

## Clarifications

### Session 2026-10-19

- Q: What happens to the existing `retired` marks (4 by hand, 1,035 set aside) at the switch? → A: All are deleted and none is carried into the status table ("a bit of a mess that this new system replaces"); 丁, retired by hand at 22 days' stability, becomes active, and the reader can retire it again.
- Q: Taking back an ignore returns the word to which status? → A: The status it had just before it was ignored (FR-014), whether undone at once or later on Progress.

Every word has a **status**, kept apart from its memory: **retired**, **active** or **ignored**.
Memory goes on for every word whatever its status. Status decides only where a word is shown:

| status | Cards | hardcore drill | library shares | can become active |
|---|---|---|---|---|
| retired | only as one of the day's new words | when new or due | by recall | yes, two ways |
| active | when due | when new or due | by recall | — |
| ignored | never | never | by recall | never |

## User Scenarios & Testing

### User Story 1 - Cards shows active words and the day's new words, nothing else (P1)

The reader opens Cards. Due cards are the active words whose reading recall is due; the new cards
are the day's budget, picked from tapped words that are not active and not ignored, most frequent
in general Chinese first. A retired word is never due on Cards, however long ago it was seen.

**Why this priority**: the reason for the feature; Cards is where an inconsistent rule costs time.

**Acceptance Scenarios**:

1. **Given** an active word whose recall is due, **When** Cards opens, **Then** it is among the due cards.
2. **Given** a retired word whose recall is due, **When** Cards opens, **Then** it is not among the due cards, and the library's "due come up" does not count it.
3. **Given** a never-tapped word read untapped in several attentive sessions, stability under 14 days, **When** Cards opens, **Then** it is neither due nor a new card (the known-word rule is gone).
4. **Given** a tapped retired word and room in the budget, **When** Cards opens, **Then** it can be offered as a new card in general-frequency order; an ignored tapped word never is.
5. **Given** a new card reviewed for the first time on Cards, **When** the grade is recorded, **Then** the word is active from then on.

---

### User Story 2 - A word becomes active in one of two ways, and stays active (P1)

A retired word becomes active when its reading stability reaches 14 days, whatever brought it
there (reading, watching, a drill, Cards, an Anki seed), or when it is reviewed on Cards for the
first time as one of the day's new words. Nothing else makes a word active, and nothing but the
reader's own button takes it out of active: a later drop in stability, a tap or a change of FSRS
parameters leaves it active.

**Why this priority**: it is the rule the reader can predict; deciding it in one place keeps it so.

**Acceptance Scenarios**:

1. **Given** a retired word at stability 12 days, **When** reading raises it to 15 days, **Then** it becomes active.
2. **Given** an active word, **When** a tap drops its stability to 1 day, **Then** it stays active.
3. **Given** a word the reader retired by hand at stability 200 days, **When** reading raises its stability further, **Then** it stays retired; **When** a lapse later brings it under 14 days and reading raises it past 14 again, **Then** it becomes active.
4. **Given** a retired word drilled in hardcore to stability 20 days, **When** the drill grade is recorded, **Then** it becomes active (a drill grade alone, below 14 days, does not).
5. **Given** an ignored word at stability 30 days, **When** anything happens to its memory, **Then** it stays ignored.
6. **Given** a new FSRS parameter set put in force that raises many retired words past 14 days, **When** memory is recomputed, **Then** those words become active, and no active word stops being one.

---

### User Story 3 - Retire and ignore by hand (P1)

On Cards (both faces), on a hardcore drill card, in the word sheet while reading or watching, and
in a word's detail on Progress, the reader can **Retire** a word or **Ignore** it, and undo either.
Retired leaves Cards but stays drillable and can come back; ignored is out of Cards and hardcore for
good, until the reader takes it back.

**Why this priority**: without the buttons the reader cannot move a word out of active.

**Acceptance Scenarios**:

1. **Given** an active card, **When** the reader taps Retire, **Then** it leaves Cards at once, and Undo makes it active again.
2. **Given** any word, **When** the reader taps Ignore, **Then** it is never shown on Cards or in a hardcore drill and never becomes active, and its memory goes on (the read page still colours it by recall).
3. **Given** an ignored word, **When** the reader takes the ignore back (word sheet or Progress), **Then** it returns to the status it had before it was ignored.
4. **Given** an ignored word in a document, **When** the library computes that document's shares, **Then** the word counts as known or learning by its recall, like any other word.

---

### User Story 4 - Hardcore drills new and due words, never ignored ones (P2)

A hardcore session drills a part's words that are new (no memory) or due, retired ones included,
and leaves out ignored words.

**Acceptance Scenarios**:

1. **Given** a part with an ignored due word, **When** the drill is planned and when it starts, **Then** the word is not drilled.
2. **Given** a part with a retired due word, **When** the drill is planned, **Then** it is drilled.

---

### User Story 5 - The switch keeps what is active, and starts the hand marks clean (P1)

When the app first opens on this version, every word active under the old rules becomes active
(on the 2026-10-16 backup: 2,111 words, among them 5 Anki words under 14 days never reviewed in
Reader, and every set-aside word already past 14 days). Every old `ignored`, `learning`, `known`,
`unknown` and `retired` mark is deleted from the history (in that backup: 7 hand marks on 6 words,
1,035 set-aside and 4 hand `retired` marks, no `ignored` ones), so status starts clean. A word that
was retired by hand starts retired like any other, and becomes active at once if it is past 14 days
(丁, at 22 days).

**Acceptance Scenarios**:

1. **Given** the reader's library before the switch, **When** the app opens on the new version, **Then** Cards' due count and active words are the same as just before, apart from hand-retired words past 14 days (丁), which become active.
2. **Given** the switch has run, **When** the app opens again, **Then** nothing changes (it runs once).
3. **Given** a backup copy made before the switch, **When** it is restored on the new version, **Then** the switch runs on it as on the phone.

### Edge Cases

- A word with no memory and no status row: retired, so new in hardcore, never on Cards unless tapped and picked by the budget.
- A budget pick shown but not graded: still retired; it may be offered again.
- A word retired by hand while its stability is under 14 days: the next rise past 14 makes it active.
- Undoing a Retire on Cards right after it: the word returns to active, without waiting for the 14-day rule.
- Ignoring a word that is one of today's new cards: it leaves the queue; the budget does not refill its place (as for Retire today).
- An Anki re-import: it changes seeds (memory) only, never a status.
- A withdrawn session that had raised a word past 14 days: the word stays active (active is never derived back).
- Two devices or a restored copy: status changes are ordered like other history, latest wins.
- A tap reason, "Just curious" included, changes nothing about status.

## Requirements

### Status (earned data)

- **FR-001**: Every word MUST have exactly one current status: `retired`, `active` or `ignored`. A word with no recorded status change is `retired`.
- **FR-002**: Each status change MUST be kept as a record with the word, the new status, when, and why: `reader` (a button), `stable` (reading stability reached 14 days), `first-review` (first Cards review of a budget pick) or `carried-over` (the switch). The current status MUST be the latest change in history order; replaying the records MUST reproduce it.
- **FR-003**: Status changes MUST be kept apart from the word's marks (Anki levels) and from its memory; recomputing memory MUST NOT remove or rewrite a status change.
- **FR-004**: Status changes MUST be part of the backup copy and come back exactly on restore.

### Activation (one place)

- **FR-005**: Whether a retired word becomes active MUST be decided by one function, and every path that can make a word active MUST go through it.
- **FR-006**: A retired word MUST become active (`stable`) when its reading stability is 14 days or more, provided that, since its latest change to `retired` made by the reader, its stability was below 14 days at some point. A word never retired by the reader needs only the stability.
- **FR-007**: A retired word MUST become active (`first-review`) when it is reviewed on Cards. Hardcore drill grades MUST NOT activate a word by this path; they reach FR-006 through memory like any evidence.
- **FR-008**: Nothing but the reader MUST change a word's status out of `active` or `ignored`; an `ignored` word MUST NOT become active.

### Where status applies

- **FR-009**: Cards' due cards MUST be exactly the active words whose reading memory is due (with the learn-ahead window for active words in (re)learning); the library's "due come up" counts MUST follow the same rule.
- **FR-010**: Cards' new words MUST be picked from words that were tapped at least once, have a reading memory, and are neither active nor ignored, in general-frequency order, up to the daily budget less today's first reviews.
- **FR-011**: A hardcore drill MUST classify a part's words by memory alone (new or due, as spec 014 FR-004 amended for #46) and MUST leave out ignored words, both when planned and when the drill starts.
- **FR-012**: Library shares and hardcore's coverage target MUST count a word with reading memory as known or learning by its recall, whatever its status, and a word without one as new. Marks MUST NOT decide shares.

### The reader's buttons

- **FR-013**: Retire and Ignore MUST be offered on Cards (both faces), on a hardcore drill card, in the word sheet and in Progress's word detail; each MUST be undoable where it was made.
- **FR-014**: Undo or taking back an ignore MUST restore the status the word had before that change, recorded as a new `reader` change.
- **FR-015**: Progress's word list MUST show the status (Active, Retired, Ignored) in place of today's deck status labels.

### The switch (once)

- **FR-016**: On first opening, words active under the rules in force before the switch MUST get an `active` change (`carried-over`); no other status change is carried over.
- **FR-017**: All marks asserting `ignored`, `learning`, `known`, `unknown` or `retired` MUST be deleted from the mark history, together with a `(none)` mark that only undid one of them; Anki-level marks and the Anki import's own `(none)` marks MUST stay.
- **FR-018**: The switch MUST run in one transaction, MUST run at most once per library, and MUST run on a restored pre-switch copy too.
- **FR-019**: The known-word rule, set-aside special cases, the `retireIgnored` conversion and the marks' share fallback MUST be removed.

### Key Entities

- **Status change**: word, status (`retired` / `active` / `ignored`), cause (`reader` / `stable` / `first-review` / `carried-over`), when, and its position in the device's history. Earned.
- **Current status**: the latest status change per word, or `retired`. Derived from the changes.
- **Memory**: unchanged (FSRS per skill, derived from the history); no longer carries card, known or set-aside flags.

## Success Criteria

- **SC-001**: Right after the switch on the phone, the number of active words and Cards' due count equal those just before it, plus any hand-retired word past 14 days (丁).
- **SC-002**: Every rule that decides whether a word becomes active is in one function; no other code makes a word active (checked by reading the code and a test of each path).
- **SC-003**: An ignored word appears on no Cards screen and in no hardcore drill over a week of use.
- **SC-004**: Retire or Ignore takes one tap and can be undone in one tap where it was made.
- **SC-005**: Restoring a backup reproduces every word's status exactly.

## Assumptions

- "Selected in the day's new cards" means reviewed on Cards for the first time: a pick that is shown and not graded is not yet active (today's budget counts first reviews the same way).
- The budget's pool is tapped words, retired ones included, ignored ones never (the reader, 2026-10-19).
- Set-aside words need nothing carried over: they are retired by default, and those past 14 days are active by FR-016.
- Every Anki word has a reading memory (each import writes its stability), so removing the marks' share fallback changes no Anki word's share.
- 14 days stays a named constant (ADR-0041).

## Anticipated Changes

| Change | Plausibility | Retrofit cost | Action |
|---|---|---|---|
| Change the 14-day threshold | High | Cheap: future activations only; past ones are kept as earned | One named constant |
| A fourth status (e.g. "paused until a date") | Medium | Cheap: a new value in the status change record | Status as free text with known values, like marks |
| Activate a word by hand | Medium | Cheap: one more `reader` change | Defer |
| Separate statuses for reading and listening | Low | Expensive once changes accumulate | Ignore: cards are reading cards (#7) |
| Bulk retire or ignore (a list, a frequency band) | Medium | Cheap: many `reader` changes | Defer |
| Per-status analysis in #29 (does retiring change outcomes) | Medium | Cheap if changes keep their time and cause | Keep both (FR-002) |
