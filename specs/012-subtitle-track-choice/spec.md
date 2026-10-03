# Feature Specification: Subtitle track choice at import

Created: 2026-10-03. Status: specified. Branch: main.
Input: learning channels publish several human subtitle tracks (clean Chinese, Chinese with a
pinyin line, Chinese with English, clean English). Let the reader choose the Chinese text track and
the English track at import, only when there is a real choice; otherwise import with sensible
defaults. Use a human English track instead of machine translation when one exists.

Example: Jun - Stickynote Chinese, video xEoY1KyrYls. Human tracks: `zh` "Chinese" (clean) and
`zh-Hans` "Chinese (Simplified)" (a pinyin line under every line). No human English. Before commit
f784e37 the pinyin track was imported, because its name ranked first.

## Clarifications

### Session 2026-10-03

- Q: With one clean and one mixed Chinese track (Jun's case), should import ask? → A: No: import the clean track directly; ask only with several clean Chinese tracks or a human English track.
- Q: Should phone machine translation wait until the track choice is settled? → A: Start right after download only when no choice will be asked and no human English exists; otherwise start after the choice, and only for lines the chosen English does not cover.

## User Scenarios & Testing

### US1 — Read the clean Chinese track (P1)
A video offering several Chinese tracks becomes a document whose text is clean Chinese, without
pinyin or English lines mixed in, unless no clean track exists.
Acceptance: for the Jun example the document text equals the `zh` track; a video whose only
Chinese track is mixed still imports (with that track); track names never override content.
Independent test: import the retained Jun bundle and compare the document text with the clean track.

### US2 — Choose the tracks myself when there is a choice (P1)
When a download offers more than one clean Chinese track, or a human English track, import pauses on a
choice showing each track's name, whether it is human or automatic, and its first lines. The
reader picks the Chinese text (a track, or "transcribe it myself") and the English (a track,
"machine translation" or "none"). The defaults are preselected, so confirming is one action.
Acceptance: a single clean Chinese track and no human English imports without asking, also when
mixed tracks exist beside it (the Jun example); "transcribe it myself" follows the existing no-subtitle
path; leaving the choice imports nothing and the download stays available to import later.

### US3 — Read a human English translation (P2)
A chosen English track is shown as the document's translation instead of machine translation.
Its lines are matched to the Chinese lines by time. Chinese lines with no English counterpart are
translated by machine as today, and are distinguishable from human lines.
Acceptance: each Chinese line shows the English line(s) overlapping it in time; no English line is
shown under two non-adjacent Chinese lines; lines filled by machine are marked as such.

### US4 — Change the English later (P3)
From a media document, the reader switches between the human English track, machine translation
and none. Reading history, marks and lookups are unaffected.

## Edge Cases
- Mixed tracks are recognised by content: most lines carry a separate line without Chinese.
  A few Latin words inside a Chinese line (brands, names, "iPhone") do not make a track mixed.
- Only automatic Chinese available: it is the default, labelled automatic; a human track of any
  quality is preferred over an automatic one when both are clean.
- Several Chinese tracks with identical text (YouTube sometimes serves `zh` and `zh-Hans` copies):
  shown once; no choice is asked for duplicates alone.
- A human English track must never be confused with Reader's own machine translation, on the
  phone's Termux side or in the app (both are currently stored under the same file name pattern).
- Traditional-only tracks remain importable; simplified is preferred between clean tracks.
- A track that fails to download is omitted; the video still imports.
- A download waiting for a choice does no machine translation until the reader chooses, however
  long that takes.
- Requesting YouTube's machine-translated track variants is not allowed (it caused rate limiting).

## Requirements
- **FR-001** The download keeps every human subtitle track in any language and the automatic
  Chinese track(s), with each track's language code, YouTube name and human/automatic flag.
- **FR-002** Import detects mixed tracks by content and prefers, in order: clean over mixed, human
  over automatic, simplified over traditional.
- **FR-003** A choice is shown only if more than one distinct clean Chinese track exists, or a
  human English track exists. Mixed tracks beside a single clean
  one do not cause a choice (they remain listed in the choice when it is shown for another reason). Otherwise import proceeds with the defaults of FR-002 and machine translation.
- **FR-004** The choice shows each track's name, kind and first three lines, and offers
  "transcribe it myself" for Chinese and "machine translation" / "none" for English.
- **FR-005** The Chinese text of a document is fixed once imported. Choosing another Chinese track
  later means importing the retained download again as a separate document; the existing document,
  its reading history and marks are not changed.
- **FR-006** English lines are assigned to Chinese lines by time overlap; unmatched Chinese lines
  receive machine translation, recorded as machine-made.
- **FR-011** Machine translation on the phone translates the Chinese track the document actually
  uses. It starts right after download only when no choice will be asked and no human English track
  exists; otherwise it starts once the choice is made, and only for the Chinese lines the chosen
  English track does not cover (none when every line is covered, all when "machine translation").
  It never translates a track that was not chosen.
- **FR-007** The English choice is derived data: it can be changed later without affecting reading
  history, marks, lookups or review.
- **FR-008** Unused tracks are retained with the download so a later re-import or English switch
  needs no new download.
- **FR-009** Existing documents and bundles without track metadata keep working unchanged.
- **FR-010** Mobile layout, light/dark, touch and keyboard operation for the choice.

## Key Entities
Subtitle track: language code, YouTube name, human/automatic, retained file, and whether its content
is mixed. Track choice: the Chinese track (or transcription) and the English source (track,
machine, none) recorded with the document. Translation line: English text for a Chinese line, with
its origin (human track or machine).

## Success Criteria
1. The Jun example imports as clean Chinese with no pinyin lines, by default and through the choice.
2. Imports with one clean Chinese track and no human English never show a choice.
3. A video with a human English track shows that English, matched to the right Chinese lines, on
   every line it covers; spot-checked on at least one real video of 5+ minutes.
4. Switching the English source changes no reading history, mark, lookup or review count.
5. Downloads do not trigger rate limiting more often than today's Chinese-only downloads.

## Clarifications and assumptions
- User confirmed (2026-10-03): show the choice only when there is one.
- Assumed: "English" means any human `en*` track; other languages are retained but not offered.
- Using a pinyin track to correct heteronym pinyin, and splitting a mixed track into its halves,
  are out of scope.

## Anticipated Changes
| Change | Plausibility | Retrofit cost | Action |
|---|---|---|---|
| Use a pinyin track's readings to correct heteronyms | High | Cheap if mixed tracks are retained | Retain all tracks (FR-008); no parsing now |
| Split a Chinese+English track into text and translation | Medium | Cheap with retained tracks and content detection | Defer |
| Translations into languages other than English | Low | Cheap: track language is recorded | Record language codes (FR-001) only |
| Remember a per-channel track preference | Medium | Cheap: uploader already in meta.json | Defer |
