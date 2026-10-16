# Feature Specification: Find videos by due and new words

**Feature Branch**: `015-find-videos` (worked on main, as the project does)

**Created**: 2026-10-16

**Status**: Draft

**Input**: Issue #11, "Find YouTube videos with many due words and few new words", decided by the
reader on 2026-10-16 after a laptop prototype (`scripts/content-prototypes/`, issue #11's comment):
search by query from inside Reader, subtitles only, scored as the library scores a document, a
known-share bar relative to the library (90 % by default) rather than a fixed 95 %.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Search and see which videos fit (Priority: P1)

From the library, the reader opens **Find videos**, types a query (for example "Chinese
comprehensible input intermediate") and searches. Results arrive one by one as each video's
Chinese subtitles are fetched and scored. Each shows its title, channel, duration, the share of
its running words the reader knows, the due words it contains (the words themselves) and how many
of its words the reader has never met. Videos at or above the bar come first, those with the most
due words first, then those with the fewest never-met words; videos below the bar follow, folded;
videos without Chinese subtitles are listed apart, unscored.

**Why this priority**: it is the whole value of the issue: choosing the next video by what it will
review and how readable it is, instead of guessing from a title.

**Independent Test**: with a disposable reader service serving a canned search and subtitle tracks,
a search lists the candidates with figures equal to what the same text would score as a library
document, best first, and nothing is added to the reader's history.

**Acceptance Scenarios**:

1. **Given** the reader service is running and online, **When** the reader searches a query,
   **Then** the first scored result appears before the search has finished, and every result
   with Chinese subtitles shows known %, due words and never-met count.
2. **Given** a candidate whose subtitles are the same text as a library document, **When** it is
   scored, **Then** its known %, due words and never-met words equal that document's.
3. **Given** results above and below the bar, **When** the list is shown, **Then** those at or
   above the bar come first, ordered by due-word count and then fewest never-met words, and those
   below are folded under a heading with their count.
4. **Given** a result with no Chinese subtitles (only other languages, or none), **When** the list
   is shown, **Then** it appears under "No Chinese subtitles", without figures.
5. **Given** any search, **When** it completes or is abandoned, **Then** the reader's history holds
   no new encounters, marks, sessions or documents.

---

### User Story 2 - Download the chosen video (Priority: P1)

On a result, the reader presses **Download**. The video goes to Termux's existing download, exactly
as if it had been shared to Termux, appears under New from Termux in the library with its progress,
and imports as usual.

**Why this priority**: without it the reader must leave Reader, find the video on YouTube and share
it, which is what the issue sets out to spare.

**Independent Test**: pressing Download on a result makes the reader service start a download job
for that video's address, which then shows under New from Termux like a shared video.

**Acceptance Scenarios**:

1. **Given** a result, **When** the reader presses Download, **Then** a download job for its
   address starts and the result says it is downloading, with a link to the library.
2. **Given** the video is already in the library or already downloading, **When** the result is
   shown, **Then** it says so instead of offering Download.

---

### User Story 3 - Adjust the bar and come back to recent searches (Priority: P2)

The reader moves the known-share bar (for example to 85 % for a harder week); the order and the
folding follow at once, and the bar is remembered. Recent queries are offered under the search box
and can be run again with one tap.

**Why this priority**: convenience; the defaults already make the list useful.

**Independent Test**: changing the bar re-sorts the shown results without searching again, and a
reload keeps both the bar and the recent queries.

**Acceptance Scenarios**:

1. **Given** shown results, **When** the reader changes the bar, **Then** results move between the
   two groups without a new search.
2. **Given** earlier searches, **When** the page opens, **Then** the last five distinct queries are
   offered, newest first.

### Edge Cases

- **Reader service not running or unreachable**: the page says so and offers Start Termux, as the
  library does; nothing is searched.
- **YouTube refuses (HTTP 429, rate limited)**: the affected candidates say "YouTube asked to slow
  down" and can be retried; already scored results stay; the search does not loop on retries.
- **No network**: the search fails with a message saying the phone is offline.
- **Only automatic Chinese subtitles**: they are used and the result says "automatic subtitles";
  machine translations of another language's track are never used.
- **Several human Chinese tracks** (simplified and traditional, or with pinyin lines): the track is
  chosen as importing it would choose it, so the score matches what the import will show.
- **A very long video** (a 90-minute film): it is scored like any other; its result may come later.
- **A new search while one runs**: the earlier one stops sending requests; its results are dropped.
- **The library's analyzer changes** (the word-splitting model finishes downloading): results
  already shown keep the figures they were scored with; a new search uses the new analyzer.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Reader MUST offer a Find videos page, reachable from the library, with a query box.
- **FR-002**: A search MUST ask the reader service for up to 15 YouTube results for the query, and
  for each result only its subtitle tracks, never its media.
- **FR-003**: The reader service MUST pause between requests to YouTube and MUST report a rate
  limit (HTTP 429) per candidate as a distinct, retryable state.
- **FR-004**: Tracks MUST be chosen as the import chooses them: human Chinese first, automatic
  Chinese only without a human one, never a machine translation of another language.
- **FR-005**: Reader MUST score a candidate with the same code that scores a library document:
  segmented with the analyzer the library's documents currently use, known share of running words
  as the library defines it (ignored words left out), due words as Cards counts them (active cards
  due now), never-met words (no mark, encounter, review or memory).
- **FR-006**: Results MUST appear as each candidate is scored, without waiting for the whole search.
- **FR-007**: Results MUST be grouped and ordered: at or above the bar, by due-word count then
  fewest never-met words; below the bar, folded, by known share; no Chinese subtitles, apart.
- **FR-008**: The bar MUST default to 90 % known, be adjustable on the page in whole percents
  between 70 and 99, re-order shown results at once, and be remembered on the device.
- **FR-009**: Each scored result MUST show title, channel, duration, known %, its due words, the
  number of never-met words, and whether its subtitles are automatic.
- **FR-010**: Download MUST hand the result's address to the reader service's existing download path
  (the one a share to Termux uses), so the job appears under New from Termux and imports as usual.
- **FR-011**: A result for a video already in the library, or already downloading, MUST say so
  instead of offering Download.
- **FR-012**: Searching and scoring MUST NOT write to the reader's history: no encounters, marks,
  sessions, documents or memory changes.
- **FR-013**: The last five distinct queries MUST be remembered on the device and offered on the page.
- **FR-014**: Without a running reader service, the page MUST say so and offer to start it, as the
  library does for New from Termux.

### Key Entities

- **Candidate**: one search result: YouTube id, address, title, channel, duration, and either its
  chosen Chinese subtitle text (with whether it is automatic), "no Chinese subtitles", or a
  retryable failure. Lives only on the page; never stored in the reader's history.
- **Score**: a candidate's known share, due words, never-met words, computed from the reader's
  current words when it was scored.
- **Search settings**: the bar and the recent queries, kept on the device as conveniences.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the phone, the first scored result of a search appears within 60 seconds, and a
  15-result search is fully scored within 8 minutes (the prototype's polite fetches took about
  20 s per video on the laptop's connection).
- **SC-002**: For a text that is also a library document, the shown known %, due words and
  never-met count equal the library's figures for that document exactly.
- **SC-003**: After any number of searches, the reader's history (encounters, marks, sessions,
  documents, memory) is unchanged.
- **SC-004**: A chosen video reaches New from Termux within 10 seconds of pressing Download.
- **SC-005**: A rate-limited candidate never blocks the others, and is retried only when the reader
  asks.

## Assumptions

- Search needs a network and the Termux reader service; offline, the page only explains that.
- 15 results per query is enough: the prototype found 0–15 with Chinese subtitles per query.
- Scoring happens in Reader, on the phone, with the library's analyzer: the prototype found the
  dictionary analyzer scores 1.7–10.6 points lower than the library's model, so another analyzer
  would make the figures disagree with the library's.
- Videos without Chinese subtitles (children's channels) are listed but not transcribed to score
  them; transcribing a candidate costs minutes and is out of scope.
- YouTube's search and subtitles are reached only through yt-dlp in Termux, as downloads already
  are; Reader itself never contacts YouTube (no server, ADR-0007; no embedding).
