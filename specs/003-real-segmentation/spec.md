# Feature Specification: Real Segmentation, Measured (Slice 2)

**Feature Branch**: `003-real-segmentation`

**Created**: 2026-09-02

**Status**: Draft

**Input**: Slice 2 — replace the placeholder analyzer with real Chinese word segmentation, and
nothing else. Two things are in scope and they are equally important: words that are actually words,
and a measured answer to which segmentation approach to keep.

## Purpose And Non-Goals

Slice 0 shipped an analyzer that makes every Chinese character its own word, deliberately, to prove
the language-provider seam with a second implementation. Slice 1 made the application installable,
offline-capable, and safe from silent loss, and added no reading capability at all. The result is a
tool that is now genuinely on the phone and genuinely not useful: 中国 is two words, 自行车 is
three, and the word list fills with characters instead of vocabulary.

This slice does one visible thing — makes tokens words — and one invisible thing that is equally the
point: it answers, **from evidence on the reader's own material**, which segmentation approach to
keep. That question has sat in the anticipated-changes register since before slice 0, framed there
explicitly as a measurement rather than an argument. Shipping a segmenter without answering it would
leave the project holding an opinion it has never tested.

A third thing follows from the first two without being a separate feature. Slice 0 claimed that
swapping analyzers is a *recompute against retained source*, not a migration. Nothing has ever
exercised that claim. This slice is the first analyzer swap, so the claim is either true now or it
is false now — while there are a handful of documents rather than years of them.

**Out of scope**, each scheduled elsewhere: dictionary definitions and glosses; pronunciation,
pinyin and text-to-speech; reading sessions and statistics; merging and splitting words, together
with the verified kernel that goes with them (slice 3); Anki export (slice 4); import from
subtitles, EPUB, YouTube or web pages; an export file; a second device or any synchronisation.

**Deliberately not pulled in.** The `reading_session` table. It is earned data, it does not exist in
the schema, and the reader has been reading on the phone since slice 1 deployed — so encounters are
being lost. On 2026-09-02 that loss was weighed and accepted rather than fixed here, to keep this
slice narrow. It is recorded in the register as the first candidate for whichever slice follows, and
this spec names it so the decision stays visible rather than becoming a gap again.

## Clarifications

### Session 2026-09-02

- Q: Should the vocabulary overlay — the reader's own known words winning over the dictionary when
  boundaries conflict — be built in this slice? → A: **Out of this slice.** Ship the segmenter
  alone, establish the baseline, and revisit the overlay once the word list holds real words.
  Decisive reason, sharper than plausibility or cost: every word marked so far was marked under the
  placeholder analyzer, so the word list currently holds **single characters**. An overlay letting
  known words win would take 中 marked known and use it to split 中国 into 中 + 国 — it would make
  segmentation actively *worse*, and stays that way until this slice has produced a word list
  containing real words. The overlay needs this slice to have run first, not to run beside it.

- Q: When should documents created under the placeholder analyzer be re-segmented — all at once on
  upgrade, or one at a time as the reader opens each? → A: **Both: lazily on open, plus a background
  sweep that catches up the rest while the application is idle.** Opening a stale document
  re-derives it immediately, so the reader never sees placeholder tokens; the sweep makes the
  library uniform without anyone waiting for it. The accepted cost is two paths that MUST agree, and
  a sweep that has to respect slice 1's storage lease and never compete with the document on screen.

- Q: Should the analyzer see the whole document at once, or work one line or sentence at a time? →
  A: **A unit at a time, bounded by line breaks and sentence-final punctuation.** A word never spans
  a subtitle line or a sentence end, so permitting one is always an error, and bounding the unit is
  what makes the performance target tractable. On the follow-up question of punctuation that does
  not end a sentence: the delimiter set MUST contain only characters that cannot occur inside a
  word — line breaks and CJK sentence punctuation (。！？…) qualify; the ASCII full stop does NOT,
  because in Chinese text it appears inside numbers, abbreviations and URLs. The risk is asymmetric
  and the rule follows it: a **missed** boundary merely gives the segmenter a longer stretch of
  context and is harmless, while a **false** boundary can split a real word, so when in doubt the
  text is not split. Splitting into units discards nothing — the units concatenate back and the
  delimiter remains a non-markable token — so FR-006's tiling property, asserted over the whole
  document rather than per unit, is what proves the delimiter set is not silently wrong.

- Q: Is there a size limit on reference data shipped with the application, beyond which a candidate
  is rejected regardless of how well it scores? → A: **A budget relative to slice 1's measured
  install, not a fixed cap.** A candidate that pushes install materially beyond slice 1's figure may
  still be chosen, but only with a written justification — the same mechanism the constitution
  already applies to new dependencies. Nothing is disqualified on a number picked before any
  measurement, and nothing is adopted on quality alone with its cost unrecorded.

- Q (follow-up to the segmentation-unit question): Is the line-break-and-sentence-punctuation
  rule too Chinese-centric? → A: **Yes as first
  written, and corrected.** The *rule* is language-neutral — admit a delimiter only if it cannot
  occur inside a word in that language — but the *set* is a fact about a language and therefore
  belongs to the language provider (Constitution Principle V, seam 1), not to a shared routine.
  Chinese excludes the ASCII full stop; Dutch and English depend on it as their sentence terminator,
  where telling a sentence end from an abbreviation is a substantially harder problem that arrives
  with those languages rather than with this slice.

- Q: Is the quality figure in Success Criteria a hard gate that blocks shipping, or a baseline to record and
  improve on? → A: **Neither a fixed threshold nor nothing: a baseline plus two conditional gates.**
  The percentage is removed, because it was chosen before any measurement existed and would either
  pass trivially or force a much heavier candidate on the strength of an invented number. What is
  gated instead: the analyzer shipped MUST be the best-scoring candidate actually measured, or carry
  a written justification for not being, and the figure MUST be recorded as the baseline later
  changes are compared against. This matches the reference-data budget decided above — recorded
  evidence plus a written justification, rather than a fixed limit.

## Decisions Falling Due In This Slice

Two entries in the anticipated-changes register point their decision at this slice. **D1 is now
settled** in clarification and is recorded here with the reasoning that closed it. **D2 remains
provisional**, and deliberately so: it decides the ordering of a future entry rather than anything
this slice builds, so it is better judged on the evidence this slice produces than in advance of it.

**D1 — Does the vocabulary overlay belong in this slice? SETTLED: no.** The register rates
*vocabulary-overlay segmentation* (the reader's own known words winning over the dictionary)
`high` / `cheap`, borrowed from Sapling, and notes it is self-improving: correcting once fixes every
later occurrence.

*Resolved in clarification: out of this slice.* The overlay is not merely premature, it is currently
**harmful**. Every mark the reader holds was made under the placeholder analyzer, so the word list
contains single characters; letting known words win would use 中 marked known to split 中国 apart.
The overlay only becomes safe once the word list contains real words, which is what this slice
produces. Two supporting reasons stand: it would couple the analyzer to earned data at analysis
time, which is new shape rather than a swap, and its value is defined relative to a baseline that
does not exist yet.

**D2 — Does the LLM-as-joint-analyzer entry get promoted?** The register rates it `high` / `cheap`
and argues its value is being *joint*: one pass that sees the whole sentence cannot lose 花钱 to a
split that a later gloss step has no way to repair.

*Provisional: stays deferred.* The constitution requires the application to remain fully functional
without the optional LLM tier, and this slice's completion gate is reading with the network
disabled, so a joint analyzer cannot be the primary path here. What this slice owes the entry is
evidence: the measurement in User Story 3 should record whether the local candidates fail in the
specific way — context-dependent boundaries — that would justify promoting it.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The words I mark are words (Priority: P1)

The reader pastes a passage of Chinese, opens it, and taps 中国. One tap, one word. Afterwards their
word list contains 中国 — not 中 and 国 as separate entries, and not a character they never meant to
study on its own.

**Why this priority**: it is the entire visible value of the slice. This is the first slice in which
reading the application produces vocabulary rather than characters, and without it the other two
stories have nothing to operate on.

**Independent Test**: paste a passage containing multi-character words, confirm each renders as a
single markable span, mark one, and confirm the word list shows the whole word.

**Acceptance Scenarios**:

1. **Given** a document containing 我在中国学习中文, **When** it is opened, **Then** 中国, 学习 and
   中文 are each a single markable span rather than six separate ones.
2. **Given** a multi-character word displayed as one span, **When** the reader marks it known,
   **Then** the word list contains that word, and its individual characters do not appear as new
   entries created by that action.
3. **Given** text mixing Chinese with Latin letters, digits and punctuation, **When** it is opened,
   **Then** the non-Chinese runs are displayed, tile the document exactly, and remain unmarkable.
4. **Given** a proper name or an unknown word that no dictionary contains, **When** the document is
   opened, **Then** every one of its characters still belongs to some token — the boundary may be
   wrong, but no character is dropped and nothing becomes unreachable.
5. **Given** any document, **When** its tokens are concatenated in order, **Then** they reproduce
   the source text exactly.

---

### User Story 2 - My existing documents catch up (Priority: P2)

The reader has documents saved under the placeholder analyzer. After this slice ships, opening one
shows real words — without re-pasting it, and with every mark they ever made still present.

**Why this priority**: this is where slice 0's central claim gets tested. "Tokens are derived data,
so swapping the analyzer is a recompute rather than a migration" is written into the data model, the
contract and an ADR, and has never once been executed. If it is wrong, the cheapest possible moment
to find out is now.

**Independent Test**: with a document created under `character-splitter v1` in hand, complete the
upgrade and open it. Real words appear, the document was never re-imported, and the set of recorded
marks is unchanged.

**Acceptance Scenarios**:

1. **Given** a document analysed by the placeholder, **When** the reader opens it after the new
   analyzer ships, **Then** its tokens are the new analyzer's, and the document records which
   analyzer and version produced them.
2. **Given** marks made on single characters under the placeholder, **When** tokens are re-derived
   into multi-character words, **Then** no mark is deleted, altered, or reattached to a different
   word.
3. **Given** a document is re-derived, **When** its stored source text is inspected, **Then** it is
   identical to what the reader originally pasted.
4. **Given** re-derivation is interrupted — the application is closed, or storage becomes
   unavailable part-way — **When** the application is opened again, **Then** no document is left
   holding one analyzer's tokens under another analyzer's stamp, and the work resumes or retries
   rather than being silently skipped.
5. **Given** a library of documents the reader has not opened, **When** the application sits idle,
   **Then** those documents are re-derived in the background without the reader waiting, and
   opening one mid-sweep still shows real words rather than placeholder tokens.
6. **Given** the same document, **When** it is re-derived by the sweep rather than on open,
   **Then** the tokens produced are identical either way.
7. **Given** a character the reader marked under the placeholder now appears only inside a longer
   word, **When** storage is queried for that word identity, **Then** the mark is still recorded
   against it, unchanged. It is not displayed anywhere, because no screen displays vocabulary yet —
   see FR-025.

---

### User Story 3 - I can tell which segmenter is right for what I read (Priority: P3)

Rather than accepting whichever segmenter happened to ship, the reader runs the candidates over
passages of their own material — including subtitle- and transcript-like lines, which is what they
expect to be reading most — and sees where the candidates disagree and how often. The slice ends
with a written answer.

**Why this priority**: lowest priority to *ship* and highest priority not to *skip*. The reader can
use the tool without it; the project cannot choose an analyzer without it. It is placed last because
Stories 1 and 2 must work before there are real documents to compare over.

**Independent Test**: run the comparison across a set of passages and obtain a report giving, for
each pair of candidates, how much they disagree and exactly where.

**Acceptance Scenarios**:

1. **Given** a set of passages of the reader's own material, **When** the comparison runs, **Then**
   it reports for each candidate pair how much of the text they disagree about, as a proportion
   rather than an anecdote.
2. **Given** two candidates disagree about a span, **When** the reader inspects the report, **Then**
   both candidates' segmentations of that span are shown together, so the disagreement can be
   judged rather than merely counted.
3. **Given** the reader's expected material is mostly short spoken-language lines, **When** the
   comparison runs, **Then** results on short lines are reported separately from results on long
   prose, because a segmenter can be good at one and bad at the other.
4. **Given** the comparison has run, **When** the slice ends, **Then** a written conclusion exists
   stating whether the analyzer being shipped is materially worse than the alternatives held in
   reserve, and what evidence supports it. "No material difference" is an acceptable conclusion; no
   conclusion at all is not.

---

### Edge Cases

- **A word straddling a line or subtitle boundary.** Resolved: units are bounded by line breaks and
  sentence punctuation, so this cannot happen (FR-002).
- **Punctuation that does not end a sentence** — 3.14, U.S., a URL, an ellipsis. Handled by keeping
  the ASCII full stop out of the delimiter set (FR-004) rather than by trying to detect intent.
- **A unit with no internal punctuation at all** — a wall of text where the unit is the whole
  document, up to the 5,000-character import cap.
- **Reduplication** (看看, 慢慢) and **abbreviation** — one word or two? Either answer is defensible;
  the requirement is that the answer is consistent and recorded, not that it is a particular one.
- **Numbers with measure words** (三个人) and mixed digits (2026年).
- **Proper names** absent from every dictionary (玛丽亚, 张伟).
- **Text containing no Chinese at all**, and text containing only punctuation.
- **Traditional characters** appearing inside otherwise simplified text.
- **The analyzer being unavailable or behaving differently** across browser or platform versions —
  the version stamp must still identify what produced a document's tokens.
- **The import cap from slice 0** (5,000 characters) meeting a slower analyzer.
- **A previously marked character that no longer exists as a standalone word** anywhere.
- **The analyzer changing while a document is open** on screen.
- **The catch-up sweep meeting slice 1's storage lease.** A copy of the application that does not
  hold storage must not attempt catch-up work, and the sweep must not be what causes a lease to be
  lost or contended.
- **The reader opening a document the sweep is in the middle of re-deriving.**
- **Reference data the analyzer needs being large.** Slice 1 builds its offline precache list from
  the build output, so a multi-megabyte dictionary or frequency table would be precached
  automatically and silently change install size and first-load time.

## Requirements *(mandatory)*

### Functional Requirements

#### Segmenting real words

- **FR-001**: The application MUST divide Chinese text into words, where a word MAY span one or more
  characters.
- **FR-002**: Text MUST be segmented one unit at a time, where a unit is bounded by line breaks and
  by sentence-final punctuation. A word MUST NOT be proposed across such a boundary.
- **FR-003**: The delimiter set MUST be owned by the language provider, not by a shared segmentation
  routine, because what can appear inside a word is a fact about a language. The rule it MUST satisfy
  is language-neutral: a delimiter is admitted only if it cannot occur inside a word in that
  language. Where that is unclear, the text MUST NOT be split on it — a missed boundary only widens
  the context a segmenter sees, whereas a false boundary can split a real word.
- **FR-004**: For Chinese, the delimiter set is line breaks and CJK sentence punctuation. The ASCII
  full stop is excluded, because in Chinese text it occurs inside numbers, abbreviations and URLs
  rather than ending sentences. This exclusion is a fact about Chinese and MUST NOT be generalised:
  in Dutch or English the ASCII full stop *is* the sentence terminator, and separating it from
  abbreviations is a genuinely harder problem that arrives with those languages, not with this
  slice.
- **FR-005**: Segmentation units MUST reassemble into the source exactly, with delimiters retained
  as non-markable tokens. FR-006's tiling obligation MUST be asserted over the whole document rather
  than per unit, so that any error in the delimiter set is caught rather than reasoned about.
- **FR-006**: Tokens MUST tile the source exactly — ordered, non-overlapping, gapless, and
  concatenating to reproduce the input — preserving the analyzer contract's central promise
  unchanged from slice 0.
- **FR-007**: Punctuation, whitespace, digits and Latin runs MUST be tokenised so that tiling holds,
  and MUST NOT be markable.
- **FR-008**: Every character of the source MUST belong to exactly one token, including characters
  no dictionary recognises. An unknown word MAY be split wrongly; it MUST NOT be dropped.
- **FR-009**: The analyzer MUST be deterministic for a given name and version: re-analysing
  unchanged text MUST produce identical tokens, or the version stamp identifies nothing.
- **FR-010**: The application MUST record which analyzer and which version produced every document's
  tokens.
- **FR-011**: Segmentation MUST NOT require a network connection.
- **FR-012**: Word boundaries MUST be visually distinguishable in the reader, because a wrong split
  the reader cannot see is a wrong mark they cannot avoid making. The analyzer's output is never
  authoritative, and the interface MUST NOT present it as though it were.

#### Re-deriving what already exists

- **FR-013**: Documents analysed by a superseded analyzer MUST be re-derived from their retained
  source text, without the reader re-importing them.
- **FR-014**: Re-derivation MUST NOT alter stored source text in any way.
- **FR-015**: Opening a document whose tokens came from a superseded analyzer MUST re-derive it
  before it is displayed. The reader MUST NOT be shown placeholder tokens in a document they have
  opened.
- **FR-016**: A background sweep MUST re-derive the documents the reader has not opened, so the
  library becomes uniform without the reader waiting for it.
- **FR-017**: The two paths MUST agree. Re-deriving a given document on open and re-deriving it in
  the sweep MUST produce identical tokens, which follows from FR-009 and MUST be tested rather than
  assumed — two code paths that can disagree are a defect this requirement exists to prevent.
- **FR-018**: The sweep MUST yield to the reader. It MUST NOT delay opening a document, marking a
  word, or importing text, and the document on screen MUST take priority over catch-up work.
- **FR-019**: The sweep MUST NOT run in a copy of the application that does not hold storage, per
  slice 1's lease. A read-only copy MUST NOT attempt catch-up work.
- **FR-020**: A document's recorded analyzer stamp and its stored tokens MUST never disagree. Each
  document MUST be observable as either fully re-derived or not yet re-derived, never as a mixture,
  whichever path re-derived it.
- **FR-021**: Re-derivation MUST survive interruption. Closing the application or losing storage
  part-way MUST leave every document consistent, and the remaining work MUST be resumed or retried
  rather than silently skipped.
- **FR-022**: If re-derivation of an opened document is slow enough for the reader to notice, the
  application MUST say what it is doing. The sweep MUST be quiet, but its progress and any failures
  MUST be discoverable rather than invisible.

#### Not losing what was earned

- **FR-023**: Re-segmentation MUST NOT delete, alter, or reattach any recorded marking judgment.
  Marks are earned data; tokens are not.
- **FR-024**: A word marked before re-segmentation MUST still carry its mark afterwards, under the
  same word identity.
- **FR-025**: Where a previously marked form no longer appears as a standalone word in any document,
  its mark MUST NOT be deleted, altered, or made unreachable in storage. It MUST remain retrievable
  under the same word identity it was recorded against.

  *Scoped deliberately to storage.* This requirement first said such a mark must stay visible "in the
  word list". **There is no word list.** Nothing in any shipped slice displays the reader's
  vocabulary — marks are read only for the lexemes present in the document being read — so requiring
  visibility would mean building a screen this slice did not scope. The requirement is narrowed to
  what it actually protects, the earned judgment, and the missing surface is recorded under
  Anticipated Changes rather than half-satisfied here.

#### Answering the measurement question

- **FR-026**: The slice MUST produce a recorded comparison of the candidate segmentation approaches
  over passages of the reader's own material, not over a benchmark corpus.
- **FR-027**: The comparison MUST report disagreement between candidates quantitatively, and MUST
  show the disagreeing spans with each candidate's reading of them.
- **FR-028**: The comparison MUST report short spoken-language lines separately from long prose.
- **FR-029**: The slice MUST end with a written conclusion stating whether the analyzer it ships is
  materially worse, on the reader's own material, than the alternatives the register holds in
  reserve — and what evidence supports that. "No material difference" is an acceptable conclusion;
  an absent conclusion means the slice is not finished.
- **FR-030**: The analyzer shipped MUST be the best-scoring candidate measured, unless a written
  justification records why it is not. No absolute quality threshold is imposed, because no evidence
  exists yet from which to set one: a threshold chosen before measurement either passes trivially or
  forces a heavier dependency on the strength of an invented number.
- **FR-031**: The measured figure MUST be recorded as the baseline that later analyzer changes are
  compared against. A comparison that is run and not written down leaves the next change with
  nothing to beat.

#### Not regressing what slice 1 earned

- **FR-032**: Any reference data the analyzer requires MUST be available offline from the installed
  application.
- **FR-033**: The effect of that reference data on install size and first-load time MUST be measured
  and recorded, not discovered on the phone. Slice 1's offline precache is generated from the build
  output, so new data files are included automatically and their cost is invisible until measured.
- **FR-034**: The budget for that cost is stated relative to slice 1's measured install rather than
  as an absolute size. A candidate that pushes install materially beyond slice 1's figure MAY still
  be chosen, but doing so MUST carry a written justification, in the same way the constitution
  requires a named justification for every new dependency. No candidate is disqualified by size
  before it is measured, and none is adopted on quality alone without its cost recorded.
- **FR-035**: The application MUST continue to read, mark, and refuse changes it cannot keep exactly
  as slice 1 left it. This slice adds a capability; it removes no guarantee.

### Key Entities

- **Document** — the reader's source text, retained verbatim, carrying the name and version of the
  analyzer that produced its tokens. The text is **earned**: nothing reconstructs it.
- **Token** — a span of a document with a word/not-word flag and, when it is a word, a word
  identity. **Derived**: discarded and rebuilt whenever the analyzer changes, which is the entire
  premise of Story 2.
- **Lexeme** — the identity under which a word's marks accumulate: a surrogate identifier with a
  written form. Unchanged by this slice, and the reason re-segmentation is not a migration.
- **Marking judgment** — the append-only record of the reader deciding a word's status. **Earned**,
  and untouched here.
- **Analyzer** — a named, versioned way of turning text into tokens. More than one exists at the
  same time during comparison, which is what the language-provider seam was built for.
- **Comparison sample** — a passage of the reader's material together with each candidate's
  segmentation of it. **Derived**, and kept only as evidence for the written conclusion.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a passage of at least 500 characters of the reader's own material, the reader marks
  by hand where the words are, and the proportion of those words the analyzer produced as single
  tokens is measured and written down. There is **no fixed threshold**: the figure is the baseline
  every later analyzer change is compared against. What is gated is not the number but the two
  conditions in SC-002.
- **SC-002**: The analyzer shipped at the end of this slice is the best-scoring candidate that was
  actually measured — or, if it is not, a written justification records why the better scorer was
  not taken (its download size, for instance). Shipping something worse than what was measured,
  without saying so, is the failure this criterion exists to prevent.
- **SC-003**: Every document created before this slice shows real words afterwards without being
  re-imported, and the number of recorded marking judgments is identical before and after.
- **SC-004**: A document at the 5,000-character import limit opens with real words within 3 seconds
  on the phone.
- **SC-005**: Reading and marking work with the network disabled, verified from the installed
  application after a device restart.
- **SC-006**: The reader can mark a multi-character word in a single action.
- **SC-007**: The measurement question is answered in writing, citing at least five passages of the
  reader's own material, of which at least two are subtitle- or transcript-like.
- **SC-008**: Install size and first-load time after this slice are recorded and compared against
  slice 1's figures, and any material increase is accompanied by a written justification for the
  candidate that caused it.
- **SC-009**: The slice is deployed and exercised on the phone from the installed application before
  it is considered complete.

## Anticipated Changes

Per Constitution Principle V. Ratings follow `docs/anticipated-changes.md`; nothing here licenses a
seam that is not already named there.

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Vocabulary overlay (known words win over the dictionary) | high | cheap | Derived. Needs the baseline this slice establishes, and is **harmful before it** — a word list of placeholder-era characters would split real words apart. Becomes safe once real words accumulate. | **Out (D1, settled)** — revisit after a period of reading with real segmentation |
| LLM as a joint analyzer | high | cheap | Derived, and architecturally just another named analyzer. Cannot be the primary path while offline reading is the gate. | **D2 — deferred past clarification on purpose**: it orders a future entry rather than anything this slice builds, and is better judged on the evidence this slice produces |
| jieba via Pyodide | medium | cheap | A preserved option under ADR-0007, additive as another named analyzer. | Defer — **gated on this slice's measurement** |
| A contextual sequence tagger (small ONNX model) | medium | cheap | Derived; would likely become primary, with the built-in segmenter as fallback. Real work of a different kind from shipping a data file. | Defer |
| Segmentation corrections by the reader | high | **expensive** (earned) | The correction itself is earned, but no correction can exist until there is a way to make one, and that mechanism is merge and split. | **Slice 3**, with the verified kernel |
| Multi-span tokens (离合词, Dutch separable verbs) | medium | cheap | Derived; recompute, not migration. Cost of deferring is mis-segmented separable verbs meanwhile. | Defer |
| A different analyzer per document kind (subtitles versus novels) | medium | cheap | **Already hedged**: the analyzer stamp is per document, not global, so this needs no new shape. | Defer |
| Populating the `status_event` occurrence columns | high | cheap | The columns exist and are null; filling them later is a write, not a migration. Cheap by the register's own rule, so deferred by it. | Defer |
| `reading_session` (recording that a word was encountered) | high | **expensive** (earned) | Does not exist; loss accrues while the reader reads. Deliberately deferred on 2026-09-02. | **First candidate for the next slice** |
| Sentence boundary detection for alphabetic languages | medium | cheap | Arrives with Dutch. The ASCII full stop is both a sentence terminator and part of abbreviations, decimals and URLs, so the safe-by-construction rule Chinese enjoys does not transfer. Derived, and it lands inside the language-provider seam that already exists. | Defer — **do not generalise Chinese's delimiter set to it** |
| A screen showing the reader's vocabulary | high | cheap | Derived presentation over earned marks. **Surfaced 2026-09-02 while generating tasks**: marks are read only for lexemes in the open document, so a mark on a form that no longer appears standalone is retained and unreachable. Nothing is lost — the data is safe — but the reader cannot see what they have learned. | Defer; **first candidate alongside `reading_session`** |
| Traditional Chinese alongside simplified | low | cheap | Orthographic variation; a lexeme merge once identity is a surrogate id. | Ignore |

## Assumptions

- **Material for the measurement arrives as pasted text.** No new content source is built in this
  slice, so subtitle- and transcript-like material is pasted rather than imported. This is enough to
  answer the question and does not pre-empt the import work.
- **Word-hood is undefined and analyzer-dependent** (ADR-0002). Segmentation is therefore asserted
  on properties — tiling, offset validity, determinism, idempotence for a fixed version — and never
  against expected segmentations, per Constitution Principle II. Earned data is asserted exactly.
- **Marks made under the placeholder are kept as they are.** A character marked known under
  `character-splitter v1` remains a marked character; it is not migrated into a word. Reinterpreting
  past judgments would be inventing earned data.
- **The four word states remain a placeholder set.** Nothing in this slice depends on their number
  or their names.
- **The 5,000-character import cap from slice 0 stands**, and is the volume the performance criteria
  are written against.
- **One reader, one device, one language.** Chinese only; the language-provider seam is exercised but
  not extended.
- **The reader is the judge of segmentation quality.** SC-001 and the written conclusion rest on
  their hand annotation of their own material, because no available ground truth agrees with what a
  particular learner considers a word.

## Dependencies

- **Retained source text.** Every document keeps `raw_content` verbatim. The whole of Story 2 rests
  on this, and it is the point at which ADR-0003's preserve-the-inputs rule stops being theoretical.
- **The language-provider seam and its contract**
  (`specs/001-reader-walking-skeleton/contracts/analyzer.md`), including the asynchronous `analyze`
  signature added in slice 0 specifically so a model-loading or network-calling analyzer would fit.
- **Surrogate lexeme identifiers** (ADR-0002), which is what makes re-segmentation a recompute
  rather than a migration.
- **Slice 1's offline shell and storage lease.** This slice must not regress either, and its
  reference data lands inside slice 1's generated precache list.
- **Reference data, if a dictionary- or frequency-driven candidate is chosen** — CC-CEDICT is already
  named in the constitution's technology stack as a data file. This would be the first slice to ship
  one, which is why FR-031 requires its cost to be measured.
