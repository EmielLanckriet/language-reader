# Feature Specification: Encountered examples and card audio

Created: 2026-09-30. Status: specified. Branch: main.
Input: example sentences are crucial; retain where words were encountered, play the matching source
audio, synthesize individual words, and preserve the Anki deck's existing examples/audio.

## User Scenarios & Testing
### US1 — Review a familiar example (P1)
Cards prefer source passages actually encountered in Reader. The source is named and can be opened.
Examples rotate after review. Unread library occurrences must not be presented as encountered.
Acceptance: covered read/played/lookup/check ranges qualify; withdrawn sessions do not. The displayed
highlight is exactly the target word. Deleted source text with retained history remains usable.

### US2 — Keep Anki examples (P1)
A read-only laptop export brings existing example sentences, meanings and pronunciation audio into
Reader without changing either application's scheduling. Imported Anki examples are the fallback
when Reader has no encountered example. Acceptance: a studied Anki word with sentence and audio
has a reviewable example after import; repeated identical import creates no duplicate examples;
malformed bundles are rejected. No sentence is invented and no synthetic reading event is created.

### US3 — Hear the word and source passage (P1)
After revealing the answer, separate controls play word pronunciation and the example audio.
A media example displays the entire aligned subtitle passage and plays only its source interval.
Acceptance: no wrong/neighboring passage; stop at end, on card change, hiding or navigation; one
sound at a time; missing media or Mandarin voice gives a clear usable fallback. Existing Anki word
and sentence recordings are reused. New word pronunciation can use an available device voice.

## Requirements
- Preserve source text, target offsets, source identity and imported example metadata.
- Prefer encountered Reader examples, then Anki examples. Words with neither are deferred from
  Reader's queue without modifying their memory; show the number awaiting context.
- Example audio and word pronunciation are available after answer reveal, not automatically before
  recall. They do not create passive-learning encounters or change review grades.
- Source audio must match the displayed passage. Where timing is only known for a subtitle cue,
  display/play that cue rather than pretending a sub-sentence has precise timestamps.
- Reuse existing files and avoid whole-video decoding, extraction or heavy phone speech models.
- Imports preserve text/pinyin/meaning as plain text and reference content-addressed audio.
  Import errors must not report success. Text/history survive backup restore; missing audio can be
  recovered by importing the retained source bundle again.
- No paid service, subscription, remote TTS call or modification of Anki is required.
- Mobile light/dark layout, touch controls and keyboard-accessible actions.

## Key Entities
Encountered occurrence: source document, target range and retained encounter evidence.
Example: source label, text, target range, translation and optional audio reference.
Anki import: source profile/note identity, original relevant fields and audio content identities.
Audio clip: retained file plus finite start/end bounds, or a complete word/example recording.

## Success Criteria
1. Every selected Reader example has a qualifying unwithdrawn encounter covering the word.
2. Existing Anki-only words receive their original examples/audio after a read-only import.
3. Playback never continues into the next cue or after leaving the card.
4. Reimport and restore retain example text and do not change review counts or FSRS parameters.
5. Isolated browser and physical-phone checks pass without synthetic activity in the daily reader.

## Clarifications and assumptions
- User confirmed: keep the Anki deck's example sentences and audio, rather than discard those words.
- Existing Reader Anki format 2 imported scheduling/words only, so a supplementary example/audio
  import is required. Both sources stay distinguishable; importing examples is not an encounter.
- Unless the user chooses laptop Kokoro generation, use existing Anki word audio first and available
  Mandarin device TTS for other words. Voice quality and heteronym accuracy are not guaranteed.
- Texts without source audio remain valid examples with word pronunciation; no fabricated recording.
- Showing audio only after reveal preserves the existing explicit reading-recall outcome contract.

## Anticipated Changes
| Change | Plausibility | Retrofit cost | Action |
|---|---|---|---|
| Laptop Kokoro word-audio packs | High | Cheap with content-addressed audio | Reuse audio import/storage contract; generation deferred |
| Alternative example selection | High | Cheap with retained sources | Derive selection, retain source identity |
| Listening cards / pre-answer audio | High | Expensive if outcomes mixed | Separate prompt/skill protocol before collecting |
| Better sentence alignment | Medium | Cheap while media/cues retained | Do not persist guessed sub-cue timestamps |
