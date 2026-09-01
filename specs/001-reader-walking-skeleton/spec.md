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

## Clarifications

### Session 2026-09-01

- Q: Should the deployed application require any credential to read or write, given its URL is on
  the public internet? → A: Yes — a single shared secret held in an environment variable, sent by
  the client and stored in the browser. No accounts, no user model.
- Q: When the reader taps a token, how do they choose which state to give it? → A: A tap opens a
  small menu of states and the reader picks one. Noted alongside: state may later depend on
  signals the reader does not supply directly (encounter counts, whether the meaning was looked
  up), so current state is treated as a projection over recorded observations rather than a value
  the reader alone sets.
- Q: When a word is marked, which clock decides where that judgment sits in the history? → A:
  Both are stored — when the reader asserted it, and when the server received it. Slice 0 orders
  by the server clock; how they combine is decided in slice 1 when offline marking arrives.
- Q: When something goes wrong while using the app on the phone, how is the cause found? → A:
  Structured server logs, plus errors surfaced in the interface with enough detail to act on —
  which layer failed and why. No client-side error reporting service.
- Q: What is the largest document slice 0 has to accept and display? → A: Roughly 5,000
  characters, refused above that with a clear message. No pagination in slice 0; the "full
  chapter" case moves to slice 1. Accepted on the basis that raising it later is cheap.

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

The reader taps any token and assigns it a state. Tokens carrying a state are visually
distinguished from each other and from untouched text, so the reader can see at a glance how much
of a passage is familiar.

Slice 0 offers *unknown*, *learning*, *known* and *ignored*. That set is a **placeholder**, like
the dummy analyzer — enough to exercise marking, not a decision about what states this product
ends up having.

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
- **Text over the size limit**: refused on submission with a message stating the limit and the
  submitted length, before any document is created. Slice 0 does not paginate, so a full chapter
  is out of scope rather than slow — see FR-020.
- **Same text pasted twice**: produces two documents; marks are shared because they attach to
  words, not to documents.
- **Text containing newlines**: paragraph structure is preserved rather than collapsed.
- **Rapid repeated taps** on one token: the final state is what the reader chose, and history
  records what happened rather than a corrupted sequence.
- **Missing or wrong credential**: the request is refused and the reader is told the credential is
  the problem, rather than shown an empty library that looks like data loss.

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
- **FR-006**: Tapping a word-like token MUST open a menu of the available states, from which the
  reader picks one. States MUST be distinguished visually in the text. A menu rather than a
  cycling tap, because FR-006a refuses to promise a small fixed number of states.
- **FR-006a**: The set of available states MUST be **extensible without schema change**. It is
  configuration, not a fixed structure. Slice 0 ships *unknown*, *learning*, *known*, *ignored* as
  a placeholder set; nothing may depend on there being exactly four, on their names, or on their
  order. Adding a state later is additive and cheap; **redefining what an existing state means is
  not**, because it reinterprets marks already made.
- **FR-006b**: **Absence of a record means the word has never been judged**, which is distinct
  from any state the reader can choose. A record exists only where the reader made an explicit
  judgment — including a deliberate downgrade to *unknown*, which is a judgment and creates a
  record like any other. Words merely displayed and never touched cost no rows.
- **FR-007**: A state MUST attach to the **word**, not to the occurrence, so that marking a word in
  one document marks every occurrence of it everywhere, including in documents saved later.
- **FR-008**: Word identity MUST be represented by an internal identifier that is independent of
  the word's written form, so that the rule determining identity can change later without
  rewriting accumulated marks.
- **FR-009**: The rule deciding which occurrences count as the same word MUST belong to the
  per-language component, not to the storage design.
- **FR-010**: Every judgment the reader makes about a word MUST be appended to a permanent
  history, recording the word, **what the reader asserted**, and **two times: when the reader
  asserted it, as reported by their device, and when the server received it**. History is never
  overwritten or deleted.
- **FR-010c**: Slice 0 orders history by the server time, since every judgment is made online and
  the device clock may drift. The device time is recorded but not yet relied upon. Both MUST be
  stored from the first migration: offline marking in slice 1 makes judgments minutes or hours
  before the server sees them, and whichever time is not recorded at the moment of the judgment is
  unrecoverable afterwards.
- **FR-010a**: The history MUST record **observations, not conclusions**. An entry states that the
  reader asserted a value, not that the word's state became that value. Current state is a
  *projection* over the history, and the rule producing it MUST be replaceable without rewriting
  any entry. This matters because state may later depend on signals the reader does not supply
  directly — how often a word has been encountered, whether its meaning was looked up — at which
  point a stored conclusion would be a superseded fold frozen into the log.
- **FR-010b**: Slice 0's projection is the trivial one: the reader's most recent assertion about a
  word is its current state. No signal other than an explicit assertion exists yet. Nothing may
  depend on this remaining the rule.
- **FR-011**: Replaying that history from the beginning through the current projection MUST
  reproduce exactly the current state of every word.
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
- **FR-019**: Every request that reads or modifies reader data MUST require a single shared
  credential, supplied by configuration rather than stored in the repository. A request without it
  MUST be refused. The credential is entered once and retained by the browser; it is not an
  account, carries no identity, and MUST NOT be confused with the owner recorded under FR-013.
- **FR-021**: The server MUST emit structured logs for every request and every failure, readable
  from the deployment platform without additional tooling.
- **FR-022**: A failure the reader encounters MUST be shown in the interface with enough detail to
  identify which layer failed and why — distinguishing at minimum a rejected credential, a refused
  input, a server error, and a request that never completed. A blank screen or a bare "something
  went wrong" does not satisfy this. Rationale: developer tools are not readily available on
  Android, and Principle I makes the phone the place failures are first met, so an error the
  reader cannot read costs a round trip to another device.
- **FR-020**: Documents larger than approximately 5,000 characters MUST be refused on submission,
  with a message stating both the limit and the submitted size. Slice 0 renders a document in full
  and does not paginate. Raising this limit later is a presentation change over derived data —
  page boundaries are computed from the character offsets FR-014 already requires — and touches no
  stored data.

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
- **SC-009**: Every failure deliberately induced on the phone — wrong credential, oversized input,
  server stopped, network dropped — is identifiable from what the interface shows, without
  consulting another device.

## Anticipated Changes

Per Constitution Principle V and ADR-0001, structural decisions in this slice trace to
`docs/anticipated-changes.md`, which is authoritative. Rather than duplicating it, this section
records what specifically is expected to change about *this slice's* output.

- **The analyzer is replaced by a real segmenter (pkuseg) in slice 1.** Tokens are derived data, so
  this is a recompute against retained source content, not a migration. FR-003's requirement to
  record analyzer name and version is what makes existing documents identifiable as
  dummy-segmented and re-derivable.
- **The size limit rises and pagination arrives in slice 1.** Cheap by construction: tokens are
  derived and page boundaries are computed from character offsets rather than stored, so nothing
  earned is disturbed. The one thing to protect is the API returning retained raw content *and*
  tokens, so slice 1's offline caching is not built on a whole-document-only shape.
- **Offline marking arrives in slice 1**, at which point device time and server time diverge and
  the rule combining them must be decided. FR-010c requires both from the first migration so that
  decision can be made with the evidence rather than by reconstruction. The append-only history is
  already the right structure for merging offline writes: appended entries union without conflict
  resolution.
- **State may become computed rather than asserted.** Encounter counts arrive with reading
  sessions in slice 1, and lookup events with the dictionary. Both are *earned* — no fold recovers
  an encounter or a lookup that was never written — so they are recorded when the features that
  generate them land. The rule combining them into a state is a projection and is deliberately not
  designed now; adding a projection later is free, given FR-010a. Note that automatic state
  drift is a known source of complaint in comparable tools, where words become "known" merely by
  being scrolled past, so this warrants an experiment over recorded signals rather than a rule
  chosen up front.
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
- **The state set is a placeholder, not a decision.** Four states ship in slice 0 because marking
  needs something to choose between. Whether this product wants four discrete states, a numeric
  familiarity level, or something else is deliberately unsettled, and FR-006a keeps it so.
- **Absence of a record means never judged.** Explicitly marking a word *unknown* is a judgment
  and creates a record; a word you merely read past has none. Both remain distinguishable — the
  first has a state change in the history, the second has nothing — without writing a row for
  every character displayed.
- **Character offsets are Unicode code points**, counted identically on server and client. This is
  asserted by test rather than assumed, because the two environments count differently by default.
- **One reader, one shared secret, no accounts.** Access is gated by a single static credential,
  not by a user model. This closes the write endpoint without introducing accounts, which stay out
  of scope. Multi-reader support remains a separate, tracked change.
- **Network connectivity is assumed.** Offline capability is explicitly out of scope.
- **A phone running a current Android browser is available for the Principle I check.**

## Dependencies

- A Fly.io account with a persistent volume, for deployment and for data surviving restarts.
- An Android phone on which the deployed URL can be opened.
- No dictionary, pronunciation, or language data is required by this slice.
