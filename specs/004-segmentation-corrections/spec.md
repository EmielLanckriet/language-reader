# Feature Specification: The Reader Corrects The Segmentation

**Feature Branch**: `004-segmentation-corrections`

**Created**: 2026-09-04

**Status**: Draft

**Input**: User description: "The reader can correct how a document is segmented, and the correction is kept. Slice 2 shipped a contextual model that resolves 你是哪国人 correctly but over-splits closed-class words (一个, 这个, 不是), and no segmenter will ever be right about every boundary. A correction is EARNED data under ADR-0003 — it is the reader's judgment about their own language, it cannot be recomputed from anything, and it must survive every future analyzer change, which is precisely what tokens do not do."

## Why This Slice Exists

Slice 2 established two things by measurement. The first is that a contextual model resolves
boundaries no dictionary can: 你是哪国人 reads 你 · 是 · 哪 · 国 · 人 rather than 你 · 是 · 哪 · 国人.
The second is that the same model is confidently wrong elsewhere, splitting 一个, 这个 and 不是 into
single characters, and that dictionary merging is not a fix — it re-creates the 国人 error it was
brought in to remove.

So there is no analyzer to wait for. Every segmenter is wrong about some boundary, the reader is the
only one present who knows their language, and today their knowledge has nowhere to go: they can see
that 一个 is one word and the application has no way to be told.

This slice is therefore about **capturing a judgment, not about improving a segmenter**. That places
it firmly on the earned side of ADR-0003: a correction is the reader's opinion about their own
language, nothing can recompute it, and a correction they would have made today and could not record
is lost for good. Which is the argument for building it now rather than after the next analyzer.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Join what the segmenter split (Priority: P1)

The reader is reading and sees 一 · 个 shown as two words when it is one. They tap the first, ask for
it to be joined with what follows, and it becomes one word — here, everywhere else on the page, and
in every other document where those two characters appear that way.

**Why this priority**: It is the failure the reader has actually met, on their own phone, in their
own reading. It is also the half of the problem that is safe to apply broadly: a closed-class word
like 一个 or 不是 is one word wherever it appears.

**Independent Test**: Read a document containing 一个 several times, join it once, and confirm every
other occurrence in that document and in a second document now reads as one word — including after
closing and reopening the application.

**Acceptance Scenarios**:

1. **Given** a document showing 一 and 个 as separate words, **When** the reader joins them, **Then**
   that position shows one word 一个, and so does every other occurrence of the pair in the document.
2. **Given** a correction joining 一个, **When** the reader imports a new document containing 一个,
   **Then** it appears as one word without the reader doing anything.
3. **Given** a correction joining 一个, **When** the application is closed and reopened, **Then** the
   correction is still in force.
4. **Given** two words separated by a sentence end or a line break, **When** the reader tries to join
   them, **Then** the application refuses and says why — no word spans a boundary the writer put
   there (ADR-0013).
5. **Given** the reader has marked 一 as known, **When** they join 一个, **Then** the mark on 一 is
   untouched and 一个 is a word they have not yet judged.

---

### User Story 2 - Split what the segmenter joined (Priority: P2)

The reader sees one word where there are two — 国人 in 你是哪国人 under the dictionary, or any
compound a segmenter took whole — and separates it at the point they choose.

**Why this priority**: It is the inverse operation and the one that makes a wrong correction
recoverable, so it is what makes US1 safe to use. It is second because the over-splitting the reader
met is more common than over-joining, and because a split needs a position rather than just a pair.

**Independent Test**: Take a document where a compound is shown as one word, split it, and confirm
both halves are separately markable and that the document still shows all of its text.

**Acceptance Scenarios**:

1. **Given** a word of two or more characters, **When** the reader splits it after the first
   character, **Then** the document shows two words and no character of the text is lost or repeated.
2. **Given** a split correction, **When** the reader marks one half, **Then** the mark attaches to
   that half and not to the original word.
3. **Given** the reader joined a pair by mistake, **When** they split it again, **Then** the document
   reads as it did before the mistake.
4. **Given** a word of one character, **When** the reader asks to split it, **Then** the application
   does not offer the option.

---

### User Story 3 - See and undo what I have corrected (Priority: P3)

The reader can see every correction they have made, in one place, and take any of them back.

**Why this priority**: Corrections apply broadly, so a wrong one is felt broadly, and a reader who
cannot find what they have told the application cannot trust telling it anything. It is third
because US2 already provides the inverse of US1 in the place where a mistake is noticed — while
reading it — and this is about the corrections no longer in front of them.

**Independent Test**: Make three corrections, find all three in one list, undo one, and confirm the
affected documents return to the analyzer's own segmentation for that form while the other two
corrections stay in force.

**Acceptance Scenarios**:

1. **Given** several corrections, **When** the reader opens the list, **Then** each is shown with the
   form it applies to and what it does.
2. **Given** a correction in the list, **When** the reader undoes it, **Then** every document returns
   to the analyzer's segmentation for that form, and no other correction changes.
3. **Given** an undone correction, **When** the reader looks at the record of what they have done,
   **Then** both making it and undoing it are still there — undoing is a new decision, not an
   erasure (ADR-0003).
4. **Given** a correction for a form that appears in no document the reader still has, **When** they
   open the list, **Then** it is still shown, because it will apply again when that form returns.

---

### Edge Cases

- **A correction that is right here and wrong there.** 国人 is a real word in 国人皆知 and not one in
  你是哪国人. A correction that applies to a form everywhere cannot be right in both. This slice
  applies corrections by form and accepts being wrong in the rarer context; per-occurrence exceptions
  are out of scope and recorded in the register. The reader can always undo.
- **Contradictory corrections about the same form** — joined once, split later. The most recent
  decision is the one in force, which is how marks already work: the record is a history and what is
  shown is a fold over it.
- **A correction while the background upgrade is part-way through the document** (ADR-0016). The
  correction must survive the rest of the upgrade and apply to the batches not yet re-derived.
- **A correction in a copy that does not hold storage.** Refused the way a mark is refused, with the
  read-only notice — never accepted and silently dropped.
- **A join whose result is longer than any word in the language.** Not refused; the reader is the
  authority here, and a length rule is the application overruling them.
- **A split at a position that would produce an empty half.** Refused; there is nothing to show.
- **A form that a later analyzer never produces as a token at all.** The correction becomes inert
  rather than an error, and applies again if the form reappears.

## Requirements *(mandatory)*

### Functional Requirements

**Making a correction**

- **FR-001**: The reader MUST be able to join a word with the word that follows it, from the reading
  screen, without leaving the document.
- **FR-002**: The reader MUST be able to split a word of two or more characters at a position they
  choose.
- **FR-003**: A join MUST be refused when the two words are separated by anything the language
  provider treats as a boundary a word cannot span, and the refusal MUST say why.
- **FR-004**: A split MUST be refused when it would produce an empty part.
- **FR-005**: The application MUST refuse a correction it cannot store, and say so, rather than
  showing it as accepted (as slice 1 requires of any earned data).

**What a correction is**

- **FR-006**: A correction MUST be recorded as the reader's judgment about a written **form**, not
  about one position in one document, and MUST apply wherever that form appears — in every document
  they have and every document they import later.
- **FR-007**: Every correction MUST record when it was made, on which device, in what order relative
  to the reader's other decisions, and the occurrence that prompted it: which document, and where in
  it. None of that can be reconstructed afterwards.
- **FR-008**: Corrections MUST be an append-only history. Undoing a correction MUST be recorded as a
  further decision rather than by removing the original.
- **FR-009**: Where corrections about the same form disagree, the most recent MUST be the one in
  force.

**Surviving everything else**

- **FR-010**: A correction MUST survive re-derivation by any analyzer, including a change of analyzer
  version and the instalment upgrade of a document already part-way through.
- **FR-011**: Corrections MUST be applied **on top of** what the analyzer produced, and MUST NOT be
  written into a document's tokens in a way that makes the analyzer's own output unrecoverable —
  a document's recorded analyzer must continue to describe the segmentation the analyzer produced
  (ADR-0011).
- **FR-012**: The tokens the reader sees, after corrections are applied, MUST still tile the document
  exactly: every character shown exactly once, no gaps and no overlaps.
- **FR-013**: A correction MUST NOT delete, alter or reattach any marking judgment. A word that
  ceases to appear because of a correction MUST keep its marks for if it appears again.
- **FR-014**: Correcting MUST NOT alter the stored source text in any way.

**Seeing them**

- **FR-015**: The reader MUST be able to see every correction in force, each identified by the form it
  applies to and what it does to it.
- **FR-016**: The reader MUST be able to undo any correction from that list.
- **FR-017**: A correction MUST be visible in the document being read without the reader having to
  close and reopen it.

**Not required**

- **FR-018**: This slice does NOT provide per-occurrence exceptions to a correction, corrections
  shared between devices, or corrections that teach the analyzer anything. A correction is applied,
  not learned from.

### Key Entities

- **Correction**: One decision by the reader about one written form — join this pair, or split this
  form at this position — with when, on what device, in what order, and the occurrence that prompted
  it. **Earned data**: irreplaceable, append-only, never rewritten by a recompute.
- **Correction history**: Every correction and every undo, in the order the reader made them. The
  source of truth.
- **Corrections in force**: The fold over that history — what applies right now. Derived, and
  rebuildable from the history at any time, which is how it can be proved to be derived.
- **Token** (existing, derived): unchanged in kind, but now produced by the analyzer *and then*
  corrected, rather than by the analyzer alone.

## Success Criteria *(mandatory)*

- **SC-001**: The reader can join two words in no more than two taps from reading, and see the result
  immediately.
- **SC-002**: A correction made once takes effect on every occurrence in the open document within one
  second, and in every other document by the time it is next opened.
- **SC-003**: After the segmenter is replaced with a different version and every document is
  re-derived, 100% of corrections are still in force.
- **SC-004**: No marking judgment is lost, altered or moved to a different word by any correction or
  undo — measured as zero, against the reader's own recorded history.
- **SC-005**: The reader can find and undo any correction they have made in under thirty seconds,
  without knowing which document they made it in.
- **SC-006**: Rebuilding what is in force from the correction history changes nothing, demonstrating
  that only the history is authoritative.
- **SC-007**: A document with corrections applied still shows every character of its source exactly
  once.

## Assumptions

- **Corrections apply by form, everywhere.** Taken from the feature description. The cost is the
  国人 case in the edge cases above, accepted for this slice with undo as the remedy.
- **Chinese only.** One language provider ships today. What counts as the same form is the provider's
  existing identity rule, so this slice adds no opinion of its own about word identity (FR-009 of
  slice 0, ADR-0002).
- **One reader, one device.** No sharing, no sync, no server — unchanged from every slice so far. The
  device and ordering recorded in FR-007 are the hedge that makes a second device possible later
  without inventing history.
- **Corrections are not training data.** Nothing feeds back into the analyzer or the word list. That
  keeps derived data recomputable and is what lets a correction outlive an analyzer.
- **The existing marking gesture is the model for the correcting gesture.** A reader who can already
  mark a word by tapping it can be given correction controls in the same place, so the slice adds no
  new interaction concept.
