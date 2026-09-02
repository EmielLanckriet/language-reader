# Feature Specification: Installable, Offline, and Safe From Silent Loss (Slice 1)

**Feature Branch**: `002-installable-offline-reader`

**Created**: 2026-09-02

**Status**: Draft

**Input**: Slice 1 — make the reader a real application on the phone. It installs, it works with no
network, and it never accepts a change it is going to throw away.

## Purpose And Non-Goals

Slice 0 proved the architecture end to end and is not usable as a daily tool. Three things stand
between it and being one, and **each was found by running it on a real phone**, not by inspection:

1. The home-screen icon opens inside the browser, because nothing was ever installed.
2. Reading requires a network connection, because only the reader's *data* is on the device — the
   application itself is not.
3. Two copies of the application silently compete for storage, and the copy that loses keeps
   accepting documents and marks that it then discards.

This slice fixes exactly those three and adds no reading capability whatsoever. The analyzer is
untouched. That narrowness is the point: the value here is that the tool becomes usable every day,
and every addition delays that without contributing to it.

**Out of scope**, each scheduled: real segmentation and the comparison between candidate analyzers,
dictionary definitions, pronunciation, reading sessions and statistics (all slice 2); merging and
splitting words, and verified kernels (slice 3); Anki export (slice 4); import from EPUB,
subtitles, YouTube or web pages; an export file; a second device or any synchronisation; accounts
or login.

## Clarifications

### Session 2026-09-02

- Q: When a newer version has been deployed, how should the reader move onto it? → A: **An explicit
  control** — the reader is told a new version is ready and taps to take it; nothing changes until
  they do. Chosen *for now* rather than on the merits: while the application is under active
  development and deployed often, seeing exactly when a version lands is diagnostic information.
  The intended end state is automatic on next fresh start with a quiet note afterwards, and the
  switch should happen once the tool is genuinely in daily use. Recorded under Anticipated Changes
  so it is a scheduled change rather than a forgotten one.

- Q: How does the reader discover that the application can be installed at all? → A: **The
  application invites it** — a control appears when the browser signals the application is
  installable, and disappears once it is installed. Noted alongside: the browser only signals
  installability when the application genuinely qualifies, so the presence of that control is a
  live check that installation is correctly set up. Slice 0's failure was precisely that nothing
  qualified and nothing said so.

- Q: When a copy is read-only because it cannot reach storage, how does it get back to normal? →
  A: **Both** — it checks whenever the reader attempts a change, and offers a control they can use
  at any time. If the check succeeds, the change the reader was making is carried out; they do not
  have to do it twice. This does not conflict with nothing being held in hope: the check happens
  within the action, and a change is either performed immediately or refused immediately.

- Q: Should the read-only message distinguish "another copy holds the storage" from "storage is
  genuinely unavailable"? → A: **Yes, when the cause is knowable**, because the two call for
  opposite responses — close the other window, versus something is wrong with this device or
  browser. Where the cause cannot be told apart, say so honestly and show the recorded detail
  rather than guessing; sending the reader to hunt for a window that is not open is worse than
  admitting uncertainty.

- Q: Where should the reader be told that word marks made now are provisional? → A: **A permanent
  line in the existing device-information view**, with no interruption anywhere. The claim needs to
  be written down where it can be checked, not pushed at someone. A first-run notice was considered
  and rejected: it would be dismissed reflexively and then be gone precisely when someone wanted to
  know.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Read on the metro (Priority: P1)

The reader opens the application on a phone with no network at all and reads a document they saved
earlier, marking words as they go. Everything they do is still there when they surface.

**Why this priority**: Offline reading is a constitutional requirement rather than a convenience,
and it is the single largest gap between slice 0 and a tool someone actually uses. Reading happens
in exactly the places connectivity does not: undergrounds, aeroplanes, foreign SIM-less travel.

**Independent Test**: Put the device in aeroplane mode, cold-start the application, open a saved
document, mark several words, close and reopen. Delivers the whole product's value on its own.

**Acceptance Scenarios**:

1. **Given** a device with no network and an application opened online at least once before,
   **When** the reader starts the application, **Then** their library appears and any saved
   document can be opened and read.
2. **Given** no network, **When** the reader marks words, **Then** the marks are recorded and are
   still present after closing and reopening.
3. **Given** no network, **When** the reader pastes and saves new text, **Then** it is saved and
   readable, because nothing about analysing or storing it needs a network.
4. **Given** the reader has only ever opened the application once, online, **When** they later open
   it with no network, **Then** it works — being available offline required no separate action.

---

### User Story 2 - It behaves like an app, not a page (Priority: P2)

The reader installs the reader to their home screen. Tapping the icon opens it in its own window,
with no address bar, no browser tabs, and no sense of being on a website.

**Why this priority**: It is what the reader notices first, it is the difference between a tool and
a bookmark, and it is a precondition for the application being treated as an application by the
device. Second only because a page that works offline is more valuable than a window with no
address bar.

**Independent Test**: Install to the home screen, close the browser entirely, tap the icon.

**Acceptance Scenarios**:

1. **Given** the application open in a browser, **When** the reader installs it to the home screen,
   **Then** an icon appears bearing a recognisable name and image.
2. **Given** the installed icon, **When** the reader taps it, **Then** the application opens in its
   own window with no browser interface visible.
3. **Given** the installed application, **When** it opens, **Then** it lands on the reader's
   library rather than on an error or an empty page.
4. **Given** the application running in a browser on a device that supports installing it,
   **When** the reader looks at it, **Then** it offers to install itself — the reader does not
   have to know that a browser menu contains the option.
5. **Given** the application already installed, **When** the reader opens it, **Then** it no
   longer offers to install.

---

### User Story 3 - Never lose a mark to a second copy (Priority: P3)

The reader has the application open in more than one place at once. The copy that cannot reach
storage tells them so and refuses to accept changes, rather than accepting changes it will discard.

**Why this priority**: Invisible when everything is working, and the most damaging thing in this
slice when it is not. Listed last because it protects value rather than creating it — but slice 0
shipped without it and the consequence was a copy that looked perfect and silently threw work away.

**Independent Test**: Open the application in two places. Confirm that the one the reader is
looking at reads and accepts changes normally, and that the other says it cannot save, refuses a
mark and a document, and says so in place of the library rather than showing an empty one.

**Acceptance Scenarios**:

1. **Given** the application already open and holding storage, **When** the reader opens a second
   copy, **Then** the second copy states plainly that it cannot save anything and why.
2. **Given** a copy that cannot reach storage, **When** the reader tries to mark a word or save a
   document, **Then** the change is refused rather than accepted and discarded.
3. **Given** a copy that cannot reach storage, **When** the reader looks at it, **Then** it says
   plainly that it cannot reach their library and why — it does not present an empty library as
   though nothing had ever been saved.
4. **Given** the reader closes the other copy, **When** they ask this one to try again, **Then** it
   reaches storage and resumes accepting changes.
5. **Given** the reader closes the other copy, **When** they simply mark a word without asking for
   anything, **Then** the mark is recorded — the attempt itself is what restores the application,
   and the reader is not made to perform the action twice.

---

### Edge Cases

- **A new version is deployed while a document is open.** The running application keeps the version
  it started with. Nothing is swapped underneath the reader mid-session.
- **The reader has never been online.** The application cannot be made available offline before it
  has been fetched once. Opening it for the first time without a network fails, and says so.
- **Storage is exhausted while marking offline.** Refused, with the cause named, rather than
  accepting the mark and losing it.
- **The device is restarted, then opened with no network.** Works — availability offline survives a
  restart, and is not a property of the running session.
- **The application is installed *and* also open in a browser tab.** Whichever one the reader is
  looking at reaches storage and works normally. The other cannot, and says so rather than showing
  a library it cannot read. Switching between them moves which is which.
- **Both copies are in front of the reader at once**, which a phone makes unlikely and a larger
  screen does not. Only one reaches storage. The other refuses changes and says why, and cannot
  show saved content — this is the case FR-014 admits it cannot furnish.
- **Both copies are closed and one is reopened.** It reaches storage normally. Being read-only is a
  condition of the moment, never a state the application gets stuck in.
- **The cause of a read-only state cannot be determined.** The message says so and shows what was
  actually recorded, rather than naming the likelier cause and sending the reader to close a window
  that is not open.
- **A partially cached application.** If the application cannot be made whole on the device, it
  says so rather than starting and failing in an unpredictable place later.

## Requirements *(mandatory)*

### Functional Requirements

#### Installing

- **FR-001**: The reader MUST be able to install the application to their device's home screen,
  after which it opens in its own window with no browser interface visible.
- **FR-002**: The installed application MUST open to the reader's library. It MUST NOT matter what
  path the application is served from — an installation that launches to a missing page is a
  failure of this requirement, not a deployment detail.
- **FR-003**: The installed application MUST be identifiable on the home screen by a name and an
  image chosen for it, not by a generic placeholder.
- **FR-003a**: The application MUST offer installation from within itself, whenever the device
  reports that it can be installed, and MUST stop offering once it has been. Relying on the
  reader finding the option in a browser menu does not satisfy FR-001, because a reader who does
  not know the option exists will not look for it.
- **FR-003b**: Because a device only reports the application as installable once it genuinely
  qualifies, the absence of that offer on a device that should support it MUST be treated as a
  defect in this slice rather than a preference of the browser. This is the check slice 0 lacked:
  nothing qualified, and nothing said so.

#### Working offline

- **FR-004**: After the application has been opened once with a network, it MUST start and be fully
  usable for reading and marking with no network at all, including after the device is restarted.
- **FR-005**: Becoming available offline MUST require no action from the reader beyond opening the
  application once. There is no button to press and nothing to download deliberately.
- **FR-006**: With no network, the reader MUST be able to save newly pasted text, because nothing
  about accepting, analysing or storing it needs one.
- **FR-007**: If the application cannot be made completely available on the device, it MUST say so,
  rather than appearing to succeed and then failing later at an unpredictable point.
- **FR-008**: A first-ever visit with no network MUST explain that the application has not been
  fetched yet, rather than failing blankly.

#### Changing versions

- **FR-009**: A newly deployed version MUST NOT replace the running application during a session.
  The version in use when the reader started remains in use until they next start it.
- **FR-010**: When a newer version is available, the reader MUST be told, and MUST be able to move
  to it by an explicit action. The application MUST NOT change version unless the reader asks it
  to. *(A staged decision — see Clarifications. The intended end state is automatic adoption on the
  next fresh start; an explicit control is chosen while deployments are frequent and knowing
  exactly when one landed is worth a tap.)*
- **FR-011**: Moving to a new version MUST preserve every document, mark and history entry.

#### Refusing to lose work

- **FR-012**: When the application cannot reach durable storage, it MUST NOT accept any change from
  the reader. No document is saved, no mark is recorded, and nothing is held in the hope that
  storage becomes available.
- **FR-013**: In that state the application MUST state plainly that it cannot save, and what the
  reader can do about it. Where it can tell **another copy holding the storage** apart from
  **storage being unavailable on this device**, it MUST say which, because the two call for
  opposite actions. Where it cannot tell them apart it MUST say that, and show the underlying
  reason it recorded, rather than asserting whichever is more common.
- **FR-014**: The reader MUST be able to read saved content in the copy they are actually using.
  A copy that cannot reach durable storage cannot show saved content either — there is nowhere for
  it to read from — so this requirement is met by making sure the copy in front of the reader is
  the one that reaches storage, and not by furnishing a copy that does not. Accordingly, a copy
  that cannot reach storage MUST say so in place of the library. Showing an empty library would be
  indistinguishable from having lost everything, which is the fear this slice exists to end.
  *(Amended 2026-09-02 during planning. As first written this said saved content MUST remain
  readable in the read-only state, which the machinery that stores the reader's data cannot
  deliver: a copy without access has no access for reading either. The answer is to make that
  state rare rather than to make it comfortable.)*
- **FR-015**: The application MUST attempt to reach storage again whenever the reader tries to make
  a change, and MUST also offer a control that attempts it on demand. On success it MUST resume
  accepting changes without the reader restarting it, and MUST carry out the change they were
  making rather than requiring them to repeat it.
- **FR-015a**: The application MUST NOT attempt to reach storage repeatedly in the background while
  the reader is reading. Recovery is driven by the reader doing something, not by a timer.
- **FR-016**: The application MUST NOT indicate that a change has been saved unless it has been
  durably recorded. This is the requirement the whole story exists to serve, and it holds
  everywhere, not only when a second copy is open.

#### Being honest about controls

- **FR-017**: A control the reader cannot currently use MUST explain why it is unavailable.
  Disabling a control silently is a quieter version of failing silently. *(This resolves an open
  question inherited from slice 0: the save control is disabled for empty input, so the rejection
  message it would otherwise show is unreachable. Preventing the error is acceptable; leaving the
  reader to guess is not.)*

#### Being honest about the data

- **FR-018**: The view that already reports what is true of the reader's storage MUST also state
  permanently that word marks made now are provisional and may not survive the arrival of real
  segmentation, and that documents are not provisional and are never discarded. It MUST NOT
  interrupt the reader anywhere else. A notice shown once is dismissed reflexively and then absent
  when someone actually wants to know; a permanent line is checkable.

### Requirements Deliberately Included Before They Are Used

FR-009 through FR-011 concern version changes, which a single reader on a single device may
encounter rarely. They are here because an application that can silently replace itself mid-session
is a way to lose work that nothing else in the system defends against, and because the moment to
decide update semantics is before there is an installed base of one that has learned to distrust it.

### Key Entities

This slice introduces no new stored entity. It changes what the application *refuses* to do and
what it retains about itself, not what it records about the reader.

- **Application version**: which build the reader is currently running, and whether a newer one is
  available. Not reader data; derived, and discardable.
- **Storage reachability**: whether this copy can durably record changes. A condition of the
  moment, never stored.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the device in aeroplane mode and the application not running, the reader opens
  it and is reading a saved document within 30 seconds.
- **SC-002**: The installed application shows no browser interface — no address bar, no tab strip —
  on launch.
- **SC-003**: 100% of documents, marks and history survive a version change, verified by counting
  before and after.
- **SC-004**: A copy that cannot reach storage accepts **zero** changes, and tells the reader it
  cannot save within 5 seconds of opening.
- **SC-005**: 100% of marks made with no network are present after the device reconnects.
- **SC-006**: A reader who has never installed the application completes installation in under two
  minutes without instructions.
- **SC-007**: Offline availability succeeds after exactly one online visit, with no further action.
- **SC-008**: The reader completes a full read-and-mark session on their own phone, installed, in
  aeroplane mode. This slice is not complete until this happens.

## Anticipated Changes

Per Constitution Principle V and ADR-0001, structural decisions trace to
`docs/anticipated-changes.md`, which is authoritative. What follows is what is expected to change
about *this slice's* output.

Principle V requires each entry to be rated on two axes — how plausible the change is, and what
retrofitting it later would cost. The ratings are given inline below, because a register without
them is a narrative rather than a decision aid, and because the rating is what determines whether a
seam is built now, deferred, hedged, or ignored.

- **Real segmentation arrives in slice 2** and re-derives every token from retained source content.
  This is a recompute, not a migration — but it creates new words, so marks attached to today's
  single-character words do not carry across. FR-018 exists so this is not a surprise.
  **Certain; cheap.** It is a recompute from retained input, which Principle V says costs a code
  change rather than a migration. Cheap *only* while the source content is kept, which FR-014's
  neighbour requirements guarantee.
- **An export file arrives soon after.** With no server it is the only backup and the only route to
  a second device. Nothing in this slice should make the stored shape harder to serialise.
  **Likely and soon; cheap.** Serialising a relational store is mechanical, and this slice adds no
  table to it. The cost would rise only if something here began storing state that could not be
  written out — which is why nothing in this slice persists anything.
- **A second device arrives with export or synchronisation**, at which point the device identity
  and per-device counter recorded since slice 0 stop being hedges and start being load-bearing.
  **Unlikely soon; expensive if unhedged.** This is the textbook hedge case, and it was hedged in
  slice 0 — the identity and counter columns already exist and are already written. Retrofitting
  them afterwards would mean assigning identity to rows that accumulated without one, which is a
  migration of earned data. Nothing further is owed here.
- **The way one copy yields storage to another may become sharing rather than exclusion.** This
  slice requires only that a copy which cannot save refuses to pretend otherwise. A later slice may
  let several copies operate at once; that would relax this behaviour without contradicting it,
  because "never accept a change that will not be kept" remains true either way.
  **Unlikely on a phone; cheap.** It would replace how the lease is obtained, and nothing above
  that boundary would notice, because every caller already handles being refused. Deferred rather
  than hedged: there is no data shape to protect.
- **Version changes become automatic once the tool is in daily use.** FR-010 requires an explicit
  action for now, which is right while deployments are frequent and knowing precisely when a
  version landed is useful. Once that stops being interesting, the change is to adopt a new version
  on the next fresh start and say so afterwards — a smaller notice, not a larger one. Deliberately
  deferred rather than built now, because the cost of being wrong is one tap and the information
  needed to decide arrives only from real use.
  **Certain; cheap.** Deleting a control and changing when a reload happens. The rating is the
  whole justification for deferring it — an expensive change this certain would have to be built
  now.

## Assumptions

- **The application is small enough to retain on the device in full.** The machinery that stores
  and queries the reader's data is by far its largest part. If it proves too large to retain
  comfortably, what to do about it is a real decision and not a detail — but the starting
  assumption is that it fits.
- **Word marks made during this slice are provisional; documents are not.** This is a deliberate
  decision rather than an inherited default. Slice 0 declared its data disposable on the grounds
  that marks attach to single characters, and said the exemption expired when slice 1 shipped —
  written on the assumption that slice 1 replaced the segmenter. It does not. Rather than silently
  extend the exemption, this slice states the distinction plainly: **retained source content is
  earned from now on and is never discarded**, while marks on single-character words remain
  provisional until segmentation is settled. FR-018 requires telling the reader so, because someone
  reading daily for weeks will not experience their marks as disposable no matter what a register
  says.
- **A reader may reasonably have the application open twice.** This is not misuse to be scolded
  out of; installing to the home screen and later following a link both produce a copy.
- **One reader, one device, no accounts.** Unchanged from slice 0.
- **A phone with a current Android browser is available**, and the reader can put it into
  aeroplane mode to test offline behaviour honestly.

## Dependencies

- A static host requiring no payment method — unchanged from slice 0, and unchanged by this slice.
- An Android phone capable of installing a web application to its home screen.
- No dictionary, pronunciation or language data. This slice adds no language capability.
