# Feature Specification: Study time sent to the Taal challenge

**Created**: 2026-10-26 · **Status**: Draft · **Input**: decided with the reader 2026-10-26: "That
way I don't have to manually track it, which I know I won't do properly." Taal
(<https://language-81ef3.web.app/#challenge>) is a friend's app; its challenge gives points a day
for minutes of Review, Input, Output and Study, and a weekly leaderboard with friends. The friend
agrees to the reader's app signing in to it.

What Taal keeps, read from its published page on 2026-10-26 (undocumented, can change): the
reader's own log of minutes per day and mode, which Taal's page adds to its own timer and copies
to the group leaderboard while that page is open. The reader's hand entries in Taal live in the
same log.

## Clarifications

### Session 2026-10-26

- Q: When first connecting, which days are sent — today onward, the current challenge week, or every day Taal keeps? → A: The day of connecting and after (FR-011); earlier days may already be entered by hand.
- Q: Do a hardcore session's watching steps count as Study like the drill, or follow the look-up answer? → A: Only the drill step is Study; the watching steps are reading-page sessions and follow the look-up answer like any watching (FR-003).
- Q: When a drill is left idle partway through, how much of that time counts? → A: The whole drill step, from its start mark to its end mark, idle time included (FR-003).
- Q: After disconnecting and connecting again, are the days in between sent? → A: No; every connect, the first or a later one, starts from the day of connecting (FR-011).

The reader's mapping:

| in this app | in Taal |
|---|---|
| a review on Cards | a card (Taal counts 5 cards as 1 min of Review) |
| a hardcore session's drill step | Study minutes |
| reading or watching (a hardcore watching step included), session answered "Yes, every unknown word" | Study minutes |
| reading or watching, any other answer or none | Input minutes |
| — | Output: the reader enters it by hand in Taal |

## User Scenarios & Testing

### User Story 1 - Minutes reach Taal without being entered (P1)

The reader reads, watches, drills and does Cards as usual. Without doing anything, Taal's
challenge shows that day's minutes and cards under the mapped modes the next time the reader
opens it.

**Why this priority**: the reason for the feature; anything the reader must remember to do will
not be done.

**Independent Test**: connect once, read a text for 12 minutes and review 25 cards, open Taal's
challenge: today shows 12 min of Input and 25 cards.

**Acceptance Scenarios**:

1. **Given** a connected app and a 12-minute reading session with no answer to the look-up question, **When** the session ends and the app is online, **Then** Taal's log for that day gains 12 minutes of Input.
2. **Given** a session answered "Yes, every unknown word", **When** it is sent, **Then** its minutes are Study, not Input.
3. **Given** 25 reviews on Cards, **When** they are sent, **Then** Taal's log gains 25 cards; hardcore grades are not among them.
4. **Given** a hardcore part with a 6-minute unanswered watch-first step and a 14-minute drill step, **When** it is sent, **Then** Taal's log gains 14 minutes of Study and 6 of Input, and no cards.
5. **Given** the app is offline at the end of a session, **When** it is next opened online, **Then** the minutes are sent then, to the day they were studied.
6. **Given** a withdrawn session (ADR-0030), **Then** it sends nothing, and withdrawing one already sent takes its minutes back.

---

### User Story 2 - Hand entries in Taal are never lost or counted twice (P1)

The reader may also enter minutes in Taal by hand (a conversation, a podcast elsewhere), in the
same modes this app sends to. This app only ever adds or takes back its own share.

**Why this priority**: a leaderboard with wrong numbers is worse than none, and hand entries are
not recoverable once overwritten.

**Acceptance Scenarios**:

1. **Given** 15 minutes of Input entered by hand in Taal today, **When** this app sends 12 minutes of Input, **Then** Taal shows 27.
2. **Given** a session already sent as 12 minutes of Input, **When** the reader later answers "Yes, every unknown word" under More → Sessions, **Then** the next send moves those 12 minutes from Input to Study, and Taal's total for the day is unchanged.
3. **Given** a day already sent, **When** the app sends again with nothing new, **Then** Taal's log is unchanged.
4. **Given** the reader lowered a mode in Taal by hand below what this app sent, **When** this app takes minutes back, **Then** the mode stops at zero, never below.
5. **Given** a copy of the reader's data restored on another device or browser, **Then** that copy sends nothing until the reader turns sending on there, and turning it on does not send again what was already sent.

---

### User Story 3 - The reader can see that it works, and when it does not (P2)

A small line under Progress says when minutes were last sent, or why they could not be (not
signed in, offline, Taal refused them). Nothing pending is lost by a failure; it goes with the
next send that works.

**Why this priority**: Taal's format is not this project's and can change without notice; a
silent failure would mean weeks of missing points before anyone notices.

**Acceptance Scenarios**:

1. **Given** a send that worked, **Then** Progress shows its time and what it sent for today.
2. **Given** Taal refuses a send (sign-in expired, format changed, permission), **Then** Progress shows the reason and a way to retry or sign in again, and the minutes stay pending.
3. **Given** the reader never connected, **Then** nothing about Taal appears except the way to connect under More, and every other part of the app works as before.

---

### User Story 4 - Connect and disconnect (P2)

Under More, the reader connects with the Google account they use in Taal, and can disconnect.
Disconnecting stops sending and leaves Taal's log as it is.

**Acceptance Scenarios**:

1. **Given** a not-connected app, **When** the reader connects and signs in, **Then** sending starts with the days set by FR-011.
2. **Given** a connected app, **When** the reader disconnects, **Then** nothing more is sent and nothing already sent is taken back.
3. **Given** the reader disconnected on Monday and connects again on Thursday, **Then** Thursday and later are sent; Monday's share as already sent stays, and Tuesday and Wednesday are never sent.

### Edge Cases

- A session that runs past the day's end hour: each minute goes to the day it was studied in, by the same end hour as the week on Progress.
- Taal's day-reset hour differs from this app's: minutes near the boundary land on a different day than Taal's own timer would put them (the reader keeps both the same; see Assumptions).
- Taal's page is open on another device while this app sends: Taal saves its whole log when the reader edits a number there, so a send in the same moment can be lost. Accepted; the next send cannot tell. See FR-008.
- The browser verification scenarios and the laptop restore copy MUST never send to the reader's real Taal log.
- A day older than Taal keeps (70 days): not sent.
- A drill step left without an end mark: counted from its start to its last grade; with no grade, nothing.
- A drill step left open overnight and ended the next day: its minutes go to the days they fall in, idle time included, as FR-003 says (the reader can lower the day by hand in Taal).

## Requirements

### Functional Requirements

- **FR-001**: The app MUST compute, per study day, Input and Study minutes and the number of Cards reviews, by the mapping above, from the same history and day boundary the week on Progress uses, leaving out withdrawn sessions.
- **FR-002**: Reading and watching minutes MUST be the study time already recorded for the week on Progress; a session's minutes are Study when its latest answer to "Did you look up every word you didn't understand?" is "Yes, every unknown word", Input otherwise.
- **FR-003**: A hardcore session's drill-step minutes MUST count as Study, measured from the step's start mark to its end mark, idle time included (to its last grade when it has no end mark), and its grades MUST NOT count as cards. Its watching steps are reading-page sessions, counted once by FR-002 and never again as part of the hardcore session.
- **FR-004**: Nothing MUST be sent as Output or Review minutes; Cards reviews are sent as cards only.
- **FR-005**: The app MUST keep, per day and mode, what it has sent, and send only the difference between what it computes now and what it sent, adding to or taking from Taal's value and never taking it below zero.
- **FR-006**: What was sent MUST survive the export copy and its restore, so a restore never sends a day twice.
- **FR-007**: Sending MUST happen without the reader's action: after a session ends, after Cards, and when the app opens, whenever online and connected; it MUST NOT delay reading, Cards or the drill.
- **FR-008**: Each send MUST read Taal's current values and write the new ones in one step, so a value Taal changed since the last send is added to, not replaced; fields of Taal's log this app does not send MUST be left unchanged.
- **FR-009**: A failed send MUST be shown on Progress with its reason and MUST leave everything pending for the next send.
- **FR-010**: Sending MUST be off until the reader connects, and off on any device or browser whose data came from a restored copy, until the reader turns it on there.
- **FR-011**: On each connect (the first, a reconnect after disconnecting, or turning sending on for a restored copy), the app MUST send only the day of connecting (the whole day, by the day end hour) and the days after it; no day before it, and no day between a disconnect and the next connect, is ever sent, so hand entries for those days stay as they are.
- **FR-012**: The app MUST stay fully usable without Taal: no connection, no sign-in and no network change anything outside the Taal line and the connect option.
- **FR-013**: No other reader data than per-day minutes and card counts MUST leave the device; no word, text, title or session detail is sent.

### Key Entities

- **Daily share**: for one study day, the Input minutes, Study minutes and cards this app computes; derived from the history at any time.
- **Sent record**: per study day and mode, what this app has added to Taal's log; the only new state, and part of the export copy.
- **Connection**: whether sending is on on this device, and the signed-in account; never part of the export copy.

## Success Criteria

### Measurable Outcomes

- **SC-001**: After connecting once, a week of ordinary use needs no action in either app for its minutes and cards to appear in Taal's challenge.
- **SC-002**: For any day, Taal's value for Input, Study and cards equals the reader's hand entries plus this app's computed share, after any sequence of sends, re-sends, late answers, withdrawals and restores.
- **SC-003**: Reading, Cards and drills feel no different with sending on: no wait the reader can notice, online or offline.
- **SC-004**: A send that fails is visible on Progress the next time the reader opens it, and the minutes appear in Taal within one working send after the cause is fixed.

## Anticipated Changes

| Change | Plausibility | Retrofit cost | Action |
|---|---|---|---|
| Taal's log format or rules change | High | Cheap: shares are derived from the history; only the code that reads and writes the log changes | Defer; one module talks to Taal |
| A different mapping (rereading as Review, a ceiling on drill idle time) | Medium | Cheap: shares are recomputed and the next send applies the difference, for days still kept | Defer; the mapping is one function |
| Send Output (if the app gets speaking or writing) | Low | Cheap: one more mode in the share and the sent record | Ignore |
| Write the group leaderboard too | Medium | Cheap: the same share, written to one more place | Defer |
| Another tracker than Taal | Low | Cheap: shares are derived | Ignore: no interface for one service (Principle V) |
| Two devices sending at once | Low | Expensive: each device's record would add its own share | Ignore: one device sends; a restored copy starts off (FR-010) |
| What was sent is lost | — | Expensive: produced by an outside system, not recomputable | Kept in the export copy (FR-006) |

## Assumptions

- The friend adds the app's address (`emiellanckriet.github.io`) to the Taal project's allowed sign-in domains, and Taal's rules let a signed-in reader write their own challenge log, as Taal's own page does. Neither is checked yet.
- The reader keeps Taal's day-reset hour and this app's day end hour (Progress) the same; the app does not read Taal's setting.
- The group leaderboard catches up when the reader opens Taal's challenge page; this app writes only the reader's own log (decided 2026-10-26).
- "Only some", "I wasn't tracking unknown words" and no answer all count as Input; "Were you paying attention?" does not change the mode (decided 2026-10-26).
- This is the app's first outside service receiving reader data. It is an optional tier like the LLM key, not a server this app depends on, so the no-server constraint holds; the sign-in library is a new dependency and needs an ADR (Principle V).
- Taal's log format is read from its published page, not a documented interface; a change there breaks sending visibly (FR-009) until this app is adjusted.
