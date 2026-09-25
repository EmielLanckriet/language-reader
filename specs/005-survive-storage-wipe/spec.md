# Feature Specification: The Reader's Work Survives A Storage Wipe

**Feature Branch**: `005-survive-storage-wipe`

**Created**: 2026-09-25

**Status**: Draft

**Input**: User description: "The reader's earned data survives the phone's browser storage being wiped. At some point the persistent store on the phone reset and everything was lost; persist() is already requested, so something else caused it — candidates are the app running as a shortcut rather than an installed WebAPK (the emulator showed a shortcut is the fallback when install fails, and persistence is denied there), an uninstall/reinstall, site data being cleared, the deploy origin changing, or a migration. Earned data is word states, the status event log, occurrences, and (later) segmentation corrections; the retained inputs (document raw content, and media originals in OPFS media/ per ADR-0018) must also be recoverable. Derived data (tokens, caches, the model) need not be backed up. The reader should (1) be told clearly when their data is at risk (e.g. persistence denied, running as a shortcut), and (2) have a copy of earned data outside the origin's storage that restores after a wipe, with as little manual effort as possible. Videos are large (40-70 MB each) so the backup of media may differ from the backup of states. No server exists (ADR-0007); Termux exists on the phone (ADR-0017) and could hold a copy."

## Why This Slice Exists

The reader has already lost everything once. The phone's storage for the app was reset, and every
word they had marked was gone. The app already asks the browser to keep its storage, so whatever
happened got past that. Nobody knows which cause it was.

Until now the loss was cheap: marks were provisional while segmentation was being settled. That is
no longer true. The app is now in daily use, with video, lookup and transcripts, and every mark the
reader makes from here on is their own judgment. Nothing can recompute it (ADR-0003). The whole
point of the app is to accumulate those marks, and today a single wipe erases all of them.

Two things are unknown, and the slice must work whichever is true: **what caused the wipe**, and
**whether it will happen again**. So it does both. It shows the reader the conditions under which
their data is at risk, and it keeps a copy somewhere a wipe of the app's storage does not reach.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - My work comes back after a wipe (Priority: P1)

The app's storage is wiped: the app was reinstalled, site data was cleared, or something unknown
happened. The reader opens the app to an empty library. Instead of starting over, they are offered
their last copy. They accept, and their documents, word marks and history come back as they were
when the copy was made. Videos come back too, or say plainly how to get them back.

**Why this priority**: It is the loss that already happened. Everything else in this slice makes
the loss less likely; only this makes it recoverable.

**Independent Test**: Mark words in two documents, one of them a video. Wipe the app's storage
completely. Reopen the app, accept the restore, and confirm every mark, its history, and both
documents are back, with the video playable.

**Acceptance Scenarios**:

1. **Given** a copy exists and the app's storage is empty, **When** the reader opens the app,
   **Then** they are offered the restore before anything else, with the date of the copy and what it
   contains (documents, marked words).
2. **Given** the reader accepts, **When** the restore completes, **Then** every word state, every
   status event and every occurrence equals what the copy held, exactly.
3. **Given** a restored video document whose video file is not in the copy, **When** the reader
   opens it, **Then** the video plays if the file can be found where it was downloaded, or the page
   says how to get it back, and the text and marks are usable either way.
4. **Given** the reader declines, **When** they later change their mind, **Then** the restore is
   still available from the storage and diagnostics view.

---

### User Story 2 - The copy keeps itself up to date (Priority: P1)

The reader never thinks about backups. As they mark words, the copy follows without being asked.
If a wipe happens, they lose at most their most recent few minutes of marking.

**Why this priority**: A copy that has to be made by hand is a copy that is a month old on the day
it is needed. P1 alongside restore, because restore is only as good as the copy's age.

**Independent Test**: Mark a word, wait for the copy to update, wipe, restore, and confirm the word
is marked.

**Acceptance Scenarios**:

1. **Given** the reader marks a word, **When** the copy is next checked, **Then** it contains that
   mark within the freshness bound (SC-002), with no action from the reader.
2. **Given** the copy cannot be updated (its destination is unavailable), **When** that lasts past
   the freshness bound, **Then** the reader is told, in plain words, that recent work is not yet
   protected.
3. **Given** the app is used offline, **When** the destination becomes reachable again, **Then** the
   copy catches up with everything done offline.

---

### User Story 3 - I am told when my data is at risk (Priority: P2)

The reader can see, without digging, whether their data is currently protected. The app says so
clearly in each case: it is running as a shortcut rather than an installed app, the browser refused
to keep its storage, or the copy is stale or missing. It also says what to do about it.

**Why this priority**: It is the only part of this slice that can reveal *why* the wipe happened,
and it prevents the most likely repeat. It is P2 because a warning alone never brings anything back.

**Independent Test**: Open the app as a shortcut, and separately with storage protection denied.
Confirm each shows a distinct warning with a concrete next step. Open it installed and protected,
and confirm no warning shows.

**Acceptance Scenarios**:

1. **Given** the app is running in a browser tab or as a shortcut, **When** the library opens,
   **Then** a warning says the app is not installed, that its data can be removed without notice,
   and how to install it.
2. **Given** storage protection was refused, **When** the library opens, **Then** the warning says
   so, separately from the install warning.
3. **Given** everything is protected, **When** the library opens, **Then** nothing about storage is
   shown. The storage and diagnostics view still lists the state of each safeguard and the date of
   the last copy.

---

### Edge Cases

- **A copy from an older version of the app** is restored into a newer one, whose storage has since
  gained migrations. The restore must bring it forward, not refuse it or corrupt it.
- **The library is not empty** when a restore is offered, for example after a partial loss. The
  restore must not silently overwrite work newer than the copy.
- **The copy is damaged or truncated.** The app must detect that before changing anything, and say
  so, leaving storage as it was.
- **Two copies exist**, an older and a newer one. The reader is offered the newest by default.
- **The copy's destination is itself wiped**, for example Termux is uninstalled. The app notices that
  the copy is missing and warns as in User Story 2, scenario 2.
- **A mark is made in a copy of the app without the storage lease** (the read-only copy, ADR-0010).
  Nothing is written, so nothing is copied, and that is correct.
- **Derived data** (tokens, the segmentation model, caches) is absent after a restore. It is
  recomputed as usual; the restore must not wait for it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The app MUST keep a copy of all earned data somewhere a wipe of the app's own storage
  does not reach: word states, the status event log with its occurrences, the lexemes those point
  at, and segmentation corrections once they exist. **The copy lives in Termux on the same phone**
  (decided 2026-09-25). A receiver in Termux accepts it from the app, starts automatically when the
  phone boots, and keeps it in Termux's own storage, outside the app's.
- **FR-002**: The copy MUST include the retained inputs needed to rebuild every document: its raw
  content, content type, language, title and, for a media document, its subtitle file and metadata.
- **FR-003**: The copy MUST NOT need to include derived data. After a restore, derived data MUST be
  recomputed by the existing re-derivation paths.
- **FR-004**: Video and audio files MAY be left out of the copy. For each media document the copy
  MUST record enough to find the file again: the source address and the download's location on the
  device.
- **FR-005**: The copy MUST update without the reader acting, within the freshness bound (SC-002)
  after any change to earned data.
- **FR-006**: When the app's storage is empty and a copy exists, the app MUST offer to restore it
  before offering anything else, showing the copy's date and contents. The app finds the copy by
  asking the Termux receiver. If the receiver cannot be reached, the empty library MUST say so, and
  say how to start it, rather than look like a fresh install.
- **FR-007**: A restore MUST reproduce earned data exactly: the same word states, and the same events
  in the same order, attached to the same words and occurrences. Replaying the restored event log
  MUST reproduce the restored word states.
- **FR-008**: A restore MUST be all or nothing. A copy that fails validation, or a restore that fails
  partway, MUST leave storage as it was before the attempt.
- **FR-009**: A restore MUST accept copies written by any earlier version of the app, bringing them
  forward to the current storage layout.
- **FR-010**: A restore into a non-empty library MUST NOT discard earned data newer than the copy. It
  must refuse and explain, or merge without loss; silently overwriting is not allowed.
- **FR-011**: The app MUST tell the reader, distinctly for each case, when it is not installed, when
  storage protection was refused, and when the copy is missing or stale. Each warning MUST name one
  concrete action.
- **FR-012**: The storage and diagnostics view MUST show the state of each safeguard: install,
  storage protection, and the last copy's time and size. It MUST also offer the restore at any time.
- **FR-013**: The copy MUST be readable by the reader outside the app: a documented, human-inspectable
  format. That way it is still worth something if the app itself is ever gone.

### Key Entities

- **Copy**: a snapshot of the reader's earned data and retained inputs at a point in time. It has a
  creation time, the app version and storage layout that wrote it, a count of documents and marked
  words, and an integrity check.
- **Earned record**: a word state, a status event (with its occurrence), a lexeme, or a
  segmentation correction. These are exact data, restored exactly.
- **Retained input**: a document's source text and metadata, and for media its subtitle file. The
  media file itself is referenced, not necessarily included.
- **Safeguard state**: whether the app is installed, whether storage protection was granted, and
  when the last copy was made. It is shown to the reader and recorded in diagnostics.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a complete wipe of the app's storage, the reader gets back 100% of their word
  marks and their history, and every document's text, from the latest copy, in under 2 minutes of
  their own time.
- **SC-002**: At any moment, the latest copy is at most 5 minutes behind the reader's last change,
  whenever the copy's destination is available.
- **SC-003**: Making the copy never interrupts reading. Marking a word feels exactly as fast with the
  copy running as without.
- **SC-004**: A reader who opens the app in any unprotected state (not installed, protection refused,
  copy stale) sees a warning naming that state on the first screen, 100% of the time.
- **SC-005**: A copy written by the current version and by every earlier version the app has
  shipped restores without loss. This is checked for each version as part of every release.

## Clarifications

### Session 2026-09-25

- Q: Where does the automatic copy live? → A: In Termux. A receiver started at boot (Termux:Boot)
  accepts the copy over the loopback address. A manual "back up now" export was considered and
  deferred; it is the natural next step if the receiver proves unreliable.

## Assumptions

- **The copy is private to the reader and stays on their own device.** No server is introduced
  (ADR-0007). This extends ADR-0019's use of Termux beyond imports; the plan records that in an ADR.
- **Termux:Boot is installed** (F-Droid, next to Termux), so the receiver starts without the
  reader opening Termux. Android may still stop it; FR-011 and US2 scenario 2 cover that case, and
  a wipe of Termux itself is the one case this slice cannot recover from.
- **Videos are not duplicated into the copy by default.** Termux keeps each downloaded bundle in its
  own folder (ADR-0017), so the file already exists outside the app's storage; the copy records
  where. Copying 40–70 MB per video would multiply storage use for data that exists twice already.
- **"A few minutes" of loss is acceptable.** Losing the last few marks in a wipe is tolerable;
  losing weeks is what this slice exists to prevent.
- **The cause of the original wipe may stay unknown.** User Story 3 makes the likely causes visible
  on the phone, but the slice is designed to be sufficient whichever cause it was.
- **Restore is rare**, used after a wipe or on a new phone, so it may take longer than ordinary
  actions, as long as the reader's own time stays under SC-001.
- **Spec 004 (segmentation corrections) is on hold.** Its data is included in the copy's definition
  so that 004 can land without changing the copy's format incompatibly.
