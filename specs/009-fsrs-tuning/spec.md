# Feature Specification: FSRS Tuning Foundation

**Feature Branch**: current working branch (spec directory independent)
**Created**: 2026-09-30
**Status**: Specified
**Input**: Prepare adjustment of FSRS parameters from collected data before enough data exists;
decide whether flashcard grades or attentive encounters measure success.

## User Scenarios & Testing

### User Story 1 - Understand the evidence (Priority: P1)

From Cards, the reader can inspect how many delayed recall observations they have and export
the history used to evaluate their memory model, including when there is no data yet.

**Independent Test**: Open the report in an empty isolated library, then with synthetic reviews.

**Acceptance Scenarios**:
1. With no reviews, the report explains that more delayed reviews are needed; nothing is tuned.
2. With attentive encounters and explicit reviews, only explicit answers count as measured
   recall outcomes. Reading and listening counts are separate.
3. With withdrawn sessions, their events never appear in the evaluation dataset.

### User Story 2 - Compare parameters without risking a schedule (Priority: P2)

The reader can take an export to their laptop and compare a candidate's predictions against
the current parameters on later reviews, retaining the original history and schedule.

**Independent Test**: Evaluate default and supplied parameters against a synthetic exported
history. Earlier observations and later evaluation observations have distinct roles.

**Acceptance Scenarios**:
1. Each prediction is made before processing the answer it predicts.
2. Untapped words, lookups and checks can affect model state, but are not labelled successes
   or failures in the evaluation score.
3. Empty, undated or insufficient histories produce explicit limitations, never a claim that
   personalization is ready. Invalid candidate parameters are refused.
4. Reports identify the evidence rule, scheduler version, parameters and evaluation period.
5. Evaluation and export leave earned history and active schedules unchanged.

### Edge Cases

First encounters have no prior memory; same-day repetitions do not measure delayed retention.
Unknown Anki last-review dates cannot serve as a timed baseline. Backward clocks and multiple
devices can make chronological evaluation unreliable. Ignored words and withdrawn sessions
are excluded. Contextual flashcards test contextual recognition, not unaided speaking ability.

## Requirements

- **FR-001**: Offer an on-demand evidence report and local export from Cards, with loading,
  empty and retryable error states. No background optimization or network submission.
- **FR-002**: Label Again as failure and Hard/Good/Easy as success for explicit recall reviews.
  Explain that grading concerns recall before revealing the answer.
- **FR-003**: Replay the current encounter rule, but score only explicit reviews with an earlier
  memory update at least 24 hours before them. Keep exclusions countable.
- **FR-004**: Preserve separate reading/listening outcomes, provenance and inputs needed to replay.
- **FR-005**: Split eligible outcomes chronologically into an earlier development period and a
  later 20% evaluation period, never divide equal timestamps across the boundary. Report sample
  sizes, observed recall, predicted recall, log loss and Brier score; no-data metrics are absent.
- **FR-006**: Evaluate candidates on the laptop with fixed retention preference. Explain that
  comparing repeatedly against the same later data can overfit it.
- **FR-007**: Preserve original history and existing scheduling behavior. This first foundation
  does not automatically fit or apply personalized parameters, or claim a minimum count proves
  readiness. It makes the evidence and candidate evaluation path usable now.
- **FR-008**: Reject incompatible dataset versions and malformed candidates rather than silently
  adapting them. Flag imported seed and multi-device limitations.

### Key Entities

- **Evaluation dataset**: versioned, derived export of reviewed words' retained history, skill,
  attention answers, active parameters and evidence-rule identity.
- **Recall observation**: explicit grade, time, skill, prediction before answer, exclusion reason
  where appropriate. Success means the reader reports recall, not verified correctness.
- **Candidate report**: parameter identity and aggregate scores on disjoint time periods.

## Success Criteria

- **SC-001**: All passive encounters in the fixture produce zero measured outcome labels.
- **SC-002**: Changing an answer cannot change the prediction for that same answer.
- **SC-003**: Export and evaluation produce zero changes to earned history or active schedules.
- **SC-004**: Empty data and missing later-period outcomes produce no misleading numeric score.
- **SC-005**: The reader can reach the report and export within two actions from Cards.

## Assumptions

- Ultimate learning success is delayed understanding in fresh contexts per unit of study effort.
  The first measurable proxy is explicit contextual recall, with bias clearly disclosed.
- The existing attentive-encounter scheduling rule remains a hypothesis and stays unchanged.
- Later fitting must use the same intervention history as evaluation; passing guessed grades to
  a standard optimizer as if they were observed outcomes would train on our own assumptions.
- Infrastructure is useful before fitting is statistically credible. Deployment/phone validation
  remains a separately reported completion gate, given the recent overheating incident.

## Anticipated Changes

| Change | Plausibility | Retrofit cost | Action |
|---|---|---|---|
| Fit weights and encounter strengths jointly | High | Cheap, retained raw log | Defer fitting; version exports |
| In-context comprehension probes | Medium | Expensive if assistance facts lost | Retain existing raw encounters; define probe protocol before collecting |
| More review prompt types | High | Expensive if conflated | Separate skill now; future protocols need explicit identity |
| Apply/rollback personalized weights | High | Cheap before any writes | Defer earned application contract to next slice |

## Clarifications

### Session 2026-09-30

- Q: Use explicit recall as the measured outcome? A: Yes, start with explicit recall as the
  measured outcome (user confirmed 2026-09-30). No scheduling policy change.
- Coverage scan: scope, data, UX, privacy, dependencies, failure behavior and completion are
  specified. Fitting algorithm and application policy are deferred explicitly, not unresolved gates.
