# Feature Specification: Stories with your due words

**Feature Branch**: `016-due-word-stories` (worked on main)

**Created**: 2026-10-16

**Status**: Draft

**Input**: Issue #10, "Generate a story with due words using Qwen (offline if possible)", decided by
the reader on 2026-10-16: build it; written by the laptop when it is online, otherwise by the
phone; concrete everyday topics, free to leave out due words that don't fit, easy to discard.
Prototype and measurements in issue #10's comment and `scripts/content-prototypes/`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Ask for a story and read it (Priority: P1)

On the Texts page the reader taps **Write me a story**. Reader asks for a short everyday story using
some of their due words and words they know. While it is written, the page says where (the laptop or
the phone) and which draft it is on. When it is ready the reader sees the story with its figures —
known share, the due words it uses, never-met words — and chooses **Read it** (saved as an ordinary
text and opened) or **Discard** (nothing kept).

**Why this priority**: the issue's whole value: reading practice aimed at today's due words with
little that is new.

**Independent Test**: with a stub writer, a request yields a story shown with its figures; Read it
creates one text document with that story and opens it; Discard leaves the library unchanged.

**Acceptance Scenarios**:

1. **Given** the reader has due words, **When** they ask for a story, **Then** a story arrives with
   its known %, the due words it uses and its never-met count, as the library would score it.
2. **Given** a shown story, **When** the reader taps Read it, **Then** it is saved as a text titled
   "Story: " and its date, and opens in the reader like any text.
3. **Given** a shown story, **When** the reader taps Discard, **Then** no document, encounter or
   mark is added.
4. **Given** a draft containing words the reader has never met, **When** it is checked, **Then** the
   writer is asked to replace them (at most two rewrites), and the best draft is shown.

---

### User Story 2 - Laptop when online, phone otherwise (Priority: P1)

If the laptop's story writer is reachable, the story is written there (better and faster). If not,
the phone writes it with the model it already has for translation, sharing that model with
translation rather than running both at once.

**Why this priority**: it decides whether the feature works away from the laptop at all.

**Independent Test**: with the laptop writer running and reachable, the page says "on the laptop";
with it stopped, "on the phone", and a story still arrives.

**Acceptance Scenarios**:

1. **Given** the laptop writer answers, **When** a story is asked for, **Then** every draft is
   written on the laptop.
2. **Given** it does not answer within a few seconds, **When** a story is asked for, **Then** it is
   written on the phone and the page says so.
3. **Given** a translation is running on the phone, **When** the phone must write, **Then** the
   story waits for the model rather than running beside it, and the page says it is waiting.

---

### User Story 3 - Choose the length and a topic (Priority: P3)

The reader can pick a length (short, about 150 characters; normal, about 300; long, about 500) and
type an optional topic ("at the market"); both are remembered.

**Acceptance Scenarios**:

1. **Given** a topic, **When** a story is written, **Then** the request asks for that topic.

### Edge Cases

- **No due words**: the story uses words the reader is learning instead, and says so.
- **Termux not running**: the page offers Start Termux, as the library does.
- **The writer fails or times out**: the page says so and offers to try again; no partial story is
  saved.
- **A story in a non-Chinese language, or empty**: treated as a failed draft.
- **The reader leaves the page while a story is written**: the request is dropped; nothing is saved.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Texts page MUST offer Write me a story.
- **FR-002**: Reader MUST choose the words to ask for from its own memory: up to 10 due words (as
  Cards counts them, most frequent in the library first) and up to 300 known words (as the library
  counts known, most frequent first) as the preferred vocabulary.
- **FR-003**: The request MUST ask for an everyday story (family, friends, food, shopping, school,
  travel, a small problem solved, or the reader's topic), allow leaving out due words that don't
  fit, and ask for the chosen length.
- **FR-004**: Reader MUST score each draft as Find videos scores a candidate (spec 015): known
  share, due words used, never-met words; and ask for a rewrite naming the never-met words while
  there are any, at most twice; it MUST show the draft with the highest known share.
- **FR-005**: Drafts MUST be written by the laptop's writer when it answers within 3 seconds, and
  otherwise by the phone's model, which MUST NOT run while a translation holds it.
- **FR-006**: The page MUST show progress: where the story is written, which draft, and waiting for
  the model.
- **FR-007**: Read it MUST save the story as an ordinary text document (no special kind) and open it;
  reading it then records history as any text does.
- **FR-008**: Until Read it, nothing MUST be written to the reader's history or library.
- **FR-009**: Length and topic MUST be remembered on the device.

### Key Entities

- **Story request**: due words, known vocabulary, length, topic. Lives on the page.
- **Draft**: text, where it was written, its score. Lives on the page.
- **Writer**: the laptop's story writer or the phone's model, reached through the Termux service.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the laptop reachable, a story is shown within 3 minutes; on the phone alone,
  within 10 minutes (prototype: 1.7B drafts took 32–71 s per story on the laptop).
- **SC-002**: The shown story's figures equal what the same text gets once saved.
- **SC-003**: Discarding leaves the library and history unchanged.
- **SC-004**: Shown stories reach at least 85 % known in most requests (prototype: 86–94 % on the
  laptop's model, 82–92 % on the phone's).

## Assumptions

- The laptop writer is a small local server the reader starts on the laptop; it is reached over USB
  (`adb reverse`) or at a Wi-Fi address saved in Termux. Nothing is hosted (ADR-0007).
- The phone writes with Qwen3-1.7B (already in Termux for translation), thinking switched off.
- A generated story is a new context by construction; reading it is evidence like any text (#6's
  discount does not apply to a first reading).
