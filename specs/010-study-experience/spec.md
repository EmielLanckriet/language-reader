# Feature Specification: Study experience

**Created**: 2026-09-30
**Status**: Specified
**Input**: User approved the library redesign, predictable session completion, and weekly progress.

## User Scenarios & Testing

### US1 — Finish and correct a session (P1)
The reader finishes explicitly or returns after interruption and sees which session needs feedback.
The lookup question is optional, repeatable and independent of rewards.
Acceptance: Finish session opens its summary with title/date/activity; restarting the app retains
unanswered sessions; changing an answer appends a correction without deleting the earlier answer.
Leaving via navigation also offers a summary later, without a surprise modal. Storage failures
remain visible and retryable; unanswered does not imply focused or unfocused.

### US2 — Return to a welcoming library (P2)
The reader sees a clear continuation action, attractive media cards, readable titles and restrained
status information. Acceptance: continue opens the last studied available item; thumbnail absence
has a useful fallback; phone layouts and dark mode remain readable without horizontal overflow.

### US3 — Build a forgiving habit (P2)
The reader sees a Monday–Sunday calendar and a five-day goal. A day counts after at least one
minute of tracked reading/listening or five card answers, regardless of grade or attention answer.
Acceptance: one day earns one check; withdrawn sessions do not count; missing days cannot erase
previous activity. A completed session gets a brief factual acknowledgment and a clear stopping point.

### Edge cases
No activity, short sessions, hidden screens, paused media, duplicate close, app killed before flush,
restored backups, withdrawals, local midnight/DST, multiple sessions on one day, deleted documents.

## Requirements
- Persist activity and session endings as append-only encounters; no mutable earned counters.
- Show pending feedback from retained history; retain Skip as an explicit optional answer.
- Session identity/title/date must be visible when answering; latest answer wins in existing replay.
- No new attention/focus label: ask precisely whether all unknown words were looked up.
- Reading time is an estimate while visible, limited to 60 seconds after the last reading interaction.
  Playing time uses actual continuous playback divided by playback speed, excluding seeks/pauses.
- Activity must survive ordinary navigation; existing unsent recovery protects unconfirmed writes.
- Goals reward participation only. Tracked time is not a measurement of comprehension or focus.
- Weekly dates use the device's current timezone, Monday start. A short activity chunk belongs to
  its ending date. No fabricated historical reading durations; older played ranges may still support
  session feedback but do not create newly measured time.
- Empty/loading/error states and 44px actions; respect reduced motion; no network service added.

## Success Criteria
1. Unanswered sessions survive a reload and can be answered or corrected from Progress.
2. Again and Good produce identical weekly credit; attention answers never alter credit.
3. Hidden/idle reading and media seeks do not inflate new tracked activity.
4. New library and progress screens fit a 390px viewport and work in light/dark mode.

## Assumptions and clarification
2026-09-30: “Ok, go ahead” approves the preceding concrete proposal. Default goal five days;
daily threshold one minute or five answers is an explicit implementation choice, not a claim of
optimal pedagogy. No critical clarification blocks this slice. Daily streaks and a points economy
are deferred. Phone validation remains distinct from local verification.

## Anticipated Changes
| Change | Plausibility | Retrofit cost | Action |
|---|---|---|---|
| Adjustable weekly target | High | Cheap | Keep derived, defer preference UI |
| Daily streak and milestones | Medium | Cheap with retained activity | Defer |
| New review prompt types | High | Expensive if conflated | Retain skill, future protocol |
| Better engagement estimates | High | Cheap for new collection, old time unrecoverable | Store measured durations, not reward totals |
