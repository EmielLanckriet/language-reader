# Feature Specification: Reader Walking Skeleton (Slice 0)

**Feature Branch**: `001-reader-walking-skeleton`

**Created**: 2026-08-31

**Status**: Draft

**Input**: Slice 0 — the thinnest end-to-end path through every architectural layer of the
Chinese reading tool. Its purpose is to validate infrastructure and schema shape, not to be
useful for language learning.

## Purpose And Non-Goals

This slice deliberately does the least possible while still touching persistence, API, interface,
deployment, and the developer's actual phone. Simplifications listed under Out Of Scope are
**scheduled decisions, not oversights**, and MUST NOT be "improved" during implementation. A
change that makes this slice more useful but larger is a defect against its purpose.

**Out of scope**, each already scheduled: real segmentation, dictionary definitions,
pronunciation display, reading sessions and statistics (all slice 1); segmentation correction by
merging and splitting tokens (slice 2); Anki export (slice 3); import from EPUB, subtitles,
YouTube, or web pages; offline capability and home-screen installability; accounts, login, or any
notion of a second user.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Save and read a text (Priority: P1)

The reader pastes a passage of Chinese text into the application and saves it. The passage is
displayed back to them broken into individually distinguishable tokens, laid out for a phone
screen and comfortable to read at length.

**Why this priority**: Without stored text rendered as discrete tokens there is nothing to mark
and nothing to validate. This is the minimum that exercises persistence, the content-source seam,
the language-provider seam, and the interface together.

**Independent Test**: Paste a passage, save it, navigate away, return to it. Delivers value on its
own as a plain reading surface even with no marking.

**Acceptance Scenarios**:

1. **Given** an empty library, **When** the reader pastes Chinese text and saves it, **Then** the
   text is stored and appears in their list of documents.
2. **Given** a saved document, **When** the reader opens it, **Then** the full text is displayed
   as discrete tokens, in original order, with nothing added, dropped, or reordered.
3. **Given** a saved document, **When** the reader reopens the application later, **Then** the
   document is still present with identical content.

---

### User Story 2 - Mark what I know (Priority: P2)

The reader taps any token and assigns it one of four states — unknown, learning, known, or
ignored. Tokens are visually distinguished by their state, so the reader can see at a glance how
much of a passage is familiar.

**Why this priority**: This is the earned data the entire product is built to accumulate, and the
first thing whose loss would matter. It depends on Story 1 but is separately valuable and
separately testable.

**Independent Test**: Mark several tokens with different states, reload, confirm the marks and
their appearance survived.

**Acceptance Scenarios**:

1. **Given** an open document, **When** the reader taps a token and selects a state, **Then** that
   token's appearance changes to reflect the state.
2. **Given** a token marked in one document, **When** the reader opens a different document
   containing the same token, **Then** it already shows that state.
3. **Given** several marked tokens, **When** the reader reloads, **Then** every mark is unchanged.
4. **Given** a token marked known, **When** the reader marks it learning, **Then** the change takes
   effect and the earlier state remains recoverable as history.

---

### User Story 3 - Use it on my phone (Priority: P3)

The reader opens a public URL on their Android phone and uses the application there, away from
the machine it was built on.

**Why this priority**: Governed by Principle I — a feature that has never run on the target device
has not been validated. Listed last because it depends on the others existing, but it is the
condition on which this slice is complete.

**Independent Test**: Open the URL on the phone over mobile data, with the development machine
closed, and complete Stories 1 and 2.

**Acceptance Scenarios**:

1. **Given** a deployed application, **When** the reader opens its URL on their phone, **Then** the
   interface is legible and usable at phone width without horizontal scrolling.
2. **Given** work done on the phone, **When** the reader later opens the same URL on a laptop,
   **Then** the same documents and marks are present.
3. **Given** the server has restarted, **When** the reader returns, **Then** no documents or marks
   have been lost.

---

### Edge Cases

- **Empty or whitespace-only input**: rejected with a clear message rather than creating an empty
  document.
- **Non-Chinese content**: Latin letters, digits, punctuation, and whitespace appear in real
  Chinese text. They are displayed faithfully and are not markable (see Assumptions).
- **Characters outside the Basic Multilingual Plane**: rare Chinese characters occupy two UTF-16
  units. Any disagreement between server and interface about what counts as one character would
  silently corrupt every stored position. Offsets are defined once, in Unicode code points, and
  this is asserted by test.
- **Very long text**: a full chapter must remain usable on a phone rather than freezing it.
- **Same text pasted twice**: produces two documents; marks are shared because they attach to
  words, not to documents.
- **Text containing newlines**: paragraph structure is preserved rather than collapsed.
- **Rapid repeated taps** on one token: the final state is what the reader chose, and history
  records what happened rather than a corrupted sequence.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The reader MUST be able to save pasted text as a document, and to list and reopen
  saved documents.
- **FR-002**: The system MUST retain each document's source content exactly as submitted,
  unmodified, alongside a declaration of what kind of content it is. Everything derived from it is
  reproducible from this retained copy.
- **FR-003**: The system MUST divide document content into tokens using a **named, versioned
  analyzer**, and MUST record which analyzer and which version produced any given document's
  tokens.
- **FR-004**: For this slice the analyzer divides Chinese text into single characters. This is a
  deliberate placeholder. It MUST be implemented behind the same interface a real segmenter will
  use, and MUST be replaceable without changing anything else.
- **FR-005**: Tokens MUST tile their document exactly: no gaps, no overlaps, in order, and
  reassembling them MUST reproduce the source content.
- **FR-006**: The reader MUST be able to assign any token one of exactly four states — unknown,
  learning, known, ignored — and MUST see states distinguished visually.
- **FR-007**: A state MUST attach to the **word**, not to the occurrence, so that marking a word in
  one document marks every occurrence of it everywhere, including in documents saved later.
- **FR-008**: Word identity MUST be represented by an internal identifier that is independent of
  the word's written form, so that the rule determining identity can change later without
  rewriting accumulated marks.
- **FR-009**: The rule deciding which occurrences count as the same word MUST belong to the
  per-language component, not to the storage design.
- **FR-010**: Every state change MUST be appended to a permanent history recording what changed,
  from what to what, and when. History is never overwritten or deleted.
- **FR-011**: Replaying that history from the beginning MUST reproduce exactly the current state
  of every word.
- **FR-012**: Every stored state MUST record **how it was acquired**, so that marks made in the
  application can later be told apart from marks imported from elsewhere.
- **FR-013**: Every record of reader-created data MUST carry an owner, defaulting to a single
  local reader. No interface for a second reader exists in this slice.
- **FR-014**: Any stored position into a document MUST be expressed as a character offset into the
  retained source content, never as a position in the token sequence.
- **FR-015**: All reader-created data MUST survive application restart and redeployment.
- **FR-016**: The application MUST be reachable at a public URL and usable on an Android phone.
- **FR-017**: The interface MUST be legible and operable at phone width without horizontal
  scrolling, and tap targets MUST be large enough to hit reliably.
- **FR-018**: Rejected input MUST produce an explanation of what was wrong, not a silent failure.

### Requirements Deliberately Included Before They Are Used

FR-010 through FR-014 support no capability a reader can see in this slice. They are required now
because they concern **earned data** — information that exists nowhere else and cannot be
reconstructed — or because they are one-way doors. Adding them later means either fabricating
history that was never recorded or migrating accumulated data. This is the standing policy of
Constitution Principle V, and the specific items are drawn from `docs/anticipated-changes.md`.

### Key Entities

- **Document**: something the reader saved and reads. Holds the source content verbatim, a
  declaration of its content kind, its language, and which analyzer and version produced its
  tokens.
- **Word**: the thing a state attaches to. Has an identity independent of its written form. Its
  written form and language are attributes of it, not its identity.
- **Token**: one occurrence of a word at a position in a document. Derived data — discardable and
  rebuildable from the document's retained source.
- **Word State**: the reader's current judgment of one word, with its owner and how it was
  acquired. Earned data.
- **State Change**: one entry in the permanent history of how a word's state came to be what it is.
  Earned data, append-only.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The reader can go from opening the application to having a pasted passage displayed
  as markable tokens in under 30 seconds.
- **SC-002**: A passage of 2,000 characters is displayed within 2 seconds of opening it, on a
  phone, over mobile data.
- **SC-003**: Tapping a token and choosing a state produces a visible change within 200
  milliseconds, so marking a passage does not feel like waiting.
- **SC-004**: Marking 100 words in one sitting results in exactly 100 states and exactly 100
  history entries, with no losses and no duplicates.
- **SC-005**: After a deliberate restart of the running service, 100% of documents, states, and
  history are intact.
- **SC-006**: Reassembling any document's tokens reproduces its source content exactly, for every
  document, including ones containing punctuation, Latin text, newlines, and characters outside
  the Basic Multilingual Plane.
- **SC-007**: Replaying the full history reproduces current state for 100% of words.
- **SC-008**: The reader completes a full paste-read-mark cycle on their own phone, away from the
  development machine. This slice is not complete until this happens.

## Anticipated Changes

Per Constitution Principle V and ADR-0001, structural decisions in this slice trace to
`docs/anticipated-changes.md`, which is authoritative. Rather than duplicating it, this section
records what specifically is expected to change about *this slice's* output.

- **The analyzer is replaced by a real segmenter (pkuseg) in slice 1.** Tokens are derived data, so
  this is a recompute against retained source content, not a migration. FR-003's requirement to
  record analyzer name and version is what makes existing documents identifiable as
  dummy-segmented and re-derivable.
- **Reading sessions arrive in slice 1**, recorded as a document with an offset range and a time,
  from which encounter statistics are derived. FR-014's character-offset anchoring is the
  precondition.
- **Merge and split of words arrive in slice 2**, verified in Dafny, and will operate on the word
  identities this slice creates. FR-008's form-independent identifier is what makes them possible
  rather than destructive.
- **Word identity rules will change** when Dutch is added, from written form to dictionary form.
  FR-009 keeps that rule out of the storage design so the change costs no migration.
- **This slice's data is explicitly disposable** and may be wiped before slice 1, because its
  states attach to single characters rather than to words. The schema requirements above are kept
  regardless, so that slice 1 is not also a migration; what disposability buys is that a mistake
  in this slice's shape is corrected by wiping rather than by migrating. **The exemption expires
  when slice 1 ships.**

## Assumptions

- **Only Chinese is supported in this slice.** The per-language seam exists and is exercised, but
  only one language sits behind it plus the dummy analyzer.
- **Whitespace, punctuation, digits, and Latin text are displayed but not markable.** They are
  tokens for the purpose of tiling the document exactly (FR-005) but carry no state and are not
  tappable. Marking punctuation would pollute the word list with items that can never be studied.
- **"Unknown" is a real recorded state, not the absence of a record.** A word deliberately marked
  unknown is different from one never seen, and only an explicit state distinguishes them.
- **Character offsets are Unicode code points**, counted identically on server and client. This is
  asserted by test rather than assumed, because the two environments count differently by default.
- **One reader, no authentication.** The public URL is unlisted. This is acceptable because the
  slice holds no sensitive data and its contents are disposable; it is not acceptable beyond
  slice 1 and is tracked in the register.
- **Network connectivity is assumed.** Offline capability is explicitly out of scope.
- **A phone running a current Android browser is available for the Principle I check.**

## Dependencies

- A Fly.io account with a persistent volume, for deployment and for data surviving restarts.
- An Android phone on which the deployed URL can be opened.
- No dictionary, pronunciation, or language data is required by this slice.
