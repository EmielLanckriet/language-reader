# Feature Specification: Personal FSRS fitting with in-context outcomes

Created: 2026-10-04. Status: draft. Branch: main.
Input: the reader's end goal is understanding words in context; flashcards are a proxy. Score what
reading and watching show about understanding, not only card grades. A word whose English was on
screen is neither a success nor a failure. Give lookups, checks and exposures their own fitted
update rules instead of fake Again/Hard/Good grades. Fit on the laptop, judge on later history, and
let Reader apply a fitted set and roll it back. Revises ADR-0033.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Shown English never counts as understanding (Priority: P1)

The reader reads or watches with "every unknown word" in mind, sometimes reveals a line's English,
and answers the session question honestly. Words under English they saw are not credited as
understood, neither in today's schedule nor in any measurement. The learning-data evaluation now
also scores in-context outcomes, separately from card grades, so the reader can see how well the
current schedule predicts understanding in context.

**Why this priority**: it fixes credit the reader considers wrong today, and it produces the
outcome measure every later story is judged by. It needs no optimizer.

**Independent Test**: synthetic sessions with and without revealed English, recomputed memory and an
evaluation report; ships alone.

**Acceptance Scenarios**:

1. **Given** a session answered "Yes, every unknown word" in which line 3's English was revealed,
   **When** memory is recomputed, **Then** untapped words of line 3 gain nothing from that session
   and are absent from the outcome list, while untapped words of other lines are scored successes.
2. **Given** a word tapped by mistake and the tap undone, **When** evaluated, **Then** it is
   treated as untapped.
3. **Given** a session that opened with blur off in the stage view, **When** it is evaluated,
   **Then** no untapped word in it is a success; its lookups are still failures.
4. **Given** a session answered "Only some", **When** evaluated, **Then** its lookups are failures and
   its untapped words are unscored.
5. **Given** an export, **When** the laptop evaluation runs, **Then** card-grade and in-context
   outcomes are reported separately, per skill, for the earlier and later periods.

---

### User Story 2 - Fit personal parameters on the laptop (Priority: P2)

The reader exports learning data and runs one laptop command. It fits FSRS's card-review weights
together with a small set of parameters for each other event kind and the reliability of
in-context outcomes, using only the earlier period, then reports the fitted set against the
current rule and the Anki-imported weights on the later period. It says plainly when there is too
little data for a conclusion.

**Why this priority**: the reason for the work, but useless without Story 1's outcomes.

**Independent Test**: a synthetic history generated from known parameters; the fit recovers
predictions at least as good as the generating set, and the report refuses a verdict on a tiny one.

**Acceptance Scenarios**:

1. **Given** an export, **When** the fit runs, **Then** it reads only earlier-period outcomes, freezes
   the result, and scores it on later-period outcomes beside both baselines.
2. **Given** fewer later-period outcomes of a type than the minimum, **When** the report is made,
   **Then** that type is marked "too little data" and no recommendation is made from it.
3. **Given** a fitted set, **When** saved, **Then** it is one file Reader can import, carrying its
   rule version, the export it came from and its scores.

---

### User Story 3 - Apply a fitted set and roll back (Priority: P3)

In Reader, the reader imports a fitted set, sees its scores beside the current set, applies it,
and every word's memory is recomputed. Later they can return to any previous set.

**Why this priority**: changes what the reader studies; only worth it once a fit proves better.

**Independent Test**: apply a set, then roll back; memory equals the memory before applying.

**Acceptance Scenarios**:

1. **Given** a fitted set that did not beat the current one, or had too little data, **When** the
   reader tries to apply it, **Then** Reader declines and says why.
2. **Given** a fitted set that beat the current one, **When** applied, **Then** due dates change, history is untouched, and the
   applied set is recorded with when it was applied.
3. **Given** an applied set, **When** the reader rolls back, **Then** every word's memory equals what
   it was under the previous set.
4. **Given** a backup restored on another device, **When** opened, **Then** the same set is active.

### Edge Cases

- A word occurs several times in a session: one outcome per word per session; a lookup anywhere
  makes it a failure; otherwise any untapped occurrence without English shown makes it a success.
- A lookup in a line whose English was shown: still a failure (the reader needed it).
- A reveal recorded before 2026-10-04 carries only a line index: it is mapped to that line's text.
- Sessions before 2026-10-04 have no record of opening with blur off: they count as blurred unless
  a blur-off toggle was recorded in them (the reader normally keeps English blurred).
- A tap is a tap: the "I knew it" qualification goes. Checks recorded before this count as taps.
- A mistaken tap can be undone while its word sheet is open; an undone tap counts as untapped and
  creates no card. Undoing is recorded beside the tap, which itself stays in the history.
- Words met only while listening with the screen off: inputs only, never outcomes.
- Withdrawn sessions contribute nothing; segmentation corrections change which word an outcome
  belongs to on recompute, never the recorded encounter.
- An Anki seed predates Reader history: outcomes before the seed's last review are not scored.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: An untapped word is "helped" in a session when English covering it was visible:
  revealed for its line, the stage view with blur off, show-all English, or the word sheet's
  translation link for its sentence.
- **FR-002**: A helped word MUST NOT be scored as an in-context success and MUST NOT receive the
  untapped-word credit in scheduling; it is neither success nor failure.
- **FR-013**: Tapping a word MUST record only that it was tapped; the word sheet no longer asks
  whether it was known. Existing checks are treated as taps.
- **FR-014**: While the word sheet is still open, the reader MUST be able to undo the tap that
  opened it; an undone tap is treated as untapped everywhere, including not making the word a card
  (a word that was already a card stays one). The undo is append-only. Once the sheet is closed,
  the tap stands.
- **FR-003**: In a session answered "every unknown word", an untapped, unhelped word met with the
  text visible is an in-context success; in any non-withdrawn session, a lookup is an in-context
  failure. Untapped words in other sessions are unscored.
- **FR-004**: Card grades remain outcomes as in ADR-0033 (Again failure; Hard/Good/Easy success).
- **FR-005**: Each outcome is scored by the prediction made before it is applied; card and
  in-context outcomes are reported separately, per skill.
- **FR-006**: Lookups, attentive untapped exposures and listening exposures MUST each be
  able to update memory by their own rule with their own parameters, not by being converted to a
  card grade. The current evidence-2 rule remains available as a baseline.
- **FR-007**: The fit MUST use only earlier-period outcomes and MUST be scored on later-period
  outcomes against the current rule and the Anki-imported weights, with a stated minimum number of
  outcomes per type below which no verdict is given.
- **FR-008**: Fitting runs on the laptop. The phone only recomputes memory under a chosen set.
- **FR-009**: Reader MUST record which parameter set is active and every change of it, keep
  previous sets, allow returning to any of them, and include all of this in backups.
- **FR-010**: Applying or rolling back MUST NOT alter any recorded encounter, review or mark.
- **FR-011**: Session engagement answers (watched/listened, attentive) stay record-only.
- **FR-012**: Reader MUST refuse to apply a set unless its report shows that, on the later period,
  it predicted in-context reading outcomes better than the current set, with enough of them for a
  verdict, and predicted card outcomes no worse (judged only when there are enough card outcomes).
  Rolling back to a set that was active before is always allowed.

### Key Entities

- **In-context outcome**: word, skill, session, moment, success or failure, and why (tapped,
  untapped), derived from encounters and session answers; never stored as earned data.
- **Help**: a span of the text whose English was visible in a session, derived from reveal,
  setting and translation-link encounters.
- **Parameter set**: card-review weights, per-event-kind parameters, outcome reliabilities, rule
  version, provenance (export and fit) and scores. Earned once applied: which set was active when
  is part of the reader's history.
- **Activation**: an append-only record of applying or rolling back to a set.

## Success Criteria *(mandatory)*

- **SC-001**: In a property test over generated sessions, no helped word is ever a success or
  receives untapped credit, and every lookup is a failure.
- **SC-002**: On a synthetic history generated from known parameters, the fitted set's later-period
  log loss is no worse than the generating set's plus 2%.
- **SC-003**: For the reader's real export, the report gives later-period scores for each outcome
  type and skill with enough data, or says "too little data", in under 10 minutes on the laptop.
- **SC-004**: Applying then rolling back yields memory identical, field for field, to before.
- **SC-005**: Recomputing memory after applying finishes on the Samsung A71 for the reader's
  collection in under 30 seconds, with the app usable meanwhile.

## Assumptions

- Reveal, opening blur/stage state, stage toggles and translation-link taps have been recorded
  since commit 4e0f03f (2026-10-04).
- In-context outcomes exist for reading only; listening has no per-word outcome yet.
- Target retention remains the reader's preference, not a fitted value.
- Minimum for a verdict: 100 later-period outcomes of a type, revisable in planning.
- The 21 card-review weights are shared by both skills, as today; event-kind parameters may differ
  by skill.

## Anticipated Changes

| Change | Plausibility | Retrofit cost | Action |
|---|---|---|---|
| A per-word listening outcome (e.g. a "didn't catch it" headphone press) | Medium | Cheap; new encounter kind | Defer |
| Engagement answers as a fitted covariate | Medium | Cheap; already recorded | Defer (FR-011) |
| Refitting on a schedule | Medium | Cheap; same command | Defer |
| Fitting on the phone | Low | Expensive (heat, ADR-0032) | Ignore |
| Separate review weights per skill | Medium | Cheap; parameter set is versioned | Defer |

## Clarifications

### Session 2026-10-04

- Q: Older video sessions lack their opening blur state; how are they treated? → A: as blurred
  unless a blur-off toggle was recorded in them.
- Q: What does a check count as? → A: the "I knew it" qualification is removed; tapped or untapped
  only, with a way to undo a mistaken tap. Past checks count as taps.
- Q: May a set that did not predict better be applied? → A: no; only a set that beat the current
  one on the later period with enough data. Rolling back to an earlier active set stays allowed.
- Q: Which predictions decide whether a set "predicted better"? → A: in-context reading outcomes
  decide; card outcomes must be no worse.
- Q: How long can a tap be undone, and does undoing cancel its card? → A: only while the word sheet
  is open; undoing cancels the card it created (an existing card stays).
