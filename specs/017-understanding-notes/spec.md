# Feature Specification: Two notes for understanding (#29)

**Created**: 2026-10-16 · **Status**: Draft · **Input**: issue #29's analysis of 2026-10-16 named
what the history lacks; the reader asked to record two of them: whether a video could be followed
without the picture, and why a word was tapped. Listening happens in Reader's player, so no
"listened elsewhere" record is needed.

## User Scenarios & Testing

### User Story 1 - Could you follow it without the picture? (P1)

When the reader leaves a video and says they **only listened**, the questions also ask "Could you
follow it without the picture?" — Yes / Partly / No. The answer is kept with the session, like the
other answers, and can be changed later on Progress (the latest answer counts; earlier ones stay).

**Acceptance**: (1) after "Only listened", the question appears; after "Watched", it does not; (2)
an answer is recorded with the session and shown as chosen; (3) a session answered before this
change reads as not answered.

### User Story 2 - Why did you tap? (P1)

The word sheet offers, optionally, why the word was tapped: **didn't know it**, **checking the
meaning here**, **wrongly split**, **misheard**, **subtitles wrong**. Choosing one is recorded with
that tap; ignoring it records the tap as before.

**Acceptance**: (1) a reason chosen before the sheet closes is recorded on that lookup; (2) a sheet
closed without a reason records the lookup exactly as before; (3) an undone tap records no reason.

### Edge Cases

- Changing the follow answer: the latest counts, earlier ones stay in the history.
- A reason chosen and then Retire pressed: one lookup with both the choice and the reason.
- Neither note changes memory, cards or the fit until a later rule decides to use them.

## Requirements

- **FR-001**: The engagement answer MAY carry `followable`: `yes`, `partly`, `no` or null; asked only
  when the session's mode is `listened`.
- **FR-002**: A lookup MAY carry `reason`: `unknown`, `sense`, `split`, `misheard`, `subtitles`.
- **FR-003**: Records MUST be refused when either field holds another value; absent is valid
  (older records, and taps without a reason).
- **FR-004**: Memory, cards, shares and the fit MUST NOT change because of either field.
- **FR-005**: Both reach the backup copy and the issue #29 analysis unchanged (they are encounter
  detail).

## Success Criteria

- **SC-001**: Answering either takes one tap and never blocks leaving or closing the sheet.
- **SC-002**: Restoring a backup brings both back exactly.
