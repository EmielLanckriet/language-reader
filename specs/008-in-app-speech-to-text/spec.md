# Feature Specification: Reader Writes Its Own Transcripts

**Feature Branch**: `008-in-app-speech-to-text`

**Created**: 2026-09-28

**Status**: Draft

**Input**: User description: "Speech-to-text inside Reader with SenseVoice-Small, replacing Termux's
whisper transcription (base for the first chunk, large-v3-turbo after). Termux keeps downloading
videos (yt-dlp) and hands Reader the media; Reader transcribes it itself in the browser. Decided and
measured on 2026-09-28 (docs/backlog.md, 'Speech-to-text in Reader with SenseVoice', and
scripts/measure/sensevoice/): SenseVoice-Small int8 (239 MB) run through onnxruntime-web with the
verified JS pipeline in scripts/measure/sensevoice/sensevoice.mjs; number normalisation off; 30 s
windows every 28 s joined at the middle of the 2 s overlap; no pause detector. On the reader's
phone 2 threads decode a 30 s window in 22 s while 1 thread takes 38.6 s and 3–4 threads are
slower; the thread count must be calibrated once per device, and trials need separate workers.
Threads require cross-origin isolation, which the static host cannot send, so the service worker
must add it. The model is downloaded once and kept on the device (derived, ADR-0003); the
transcript streams into the reading view window by window, as today's Termux transcript does
(ADR-0019), with lines cut from token timestamps. Principle VIII applies: first lines should arrive
quickly; a slower better pass is out of scope but should stay possible. Reading must keep working
offline; transcription needs the model present but no network."

## Why This Slice Exists

**Today's transcripts are slow, and they depend on the part of the setup that keeps failing.**
Termux transcribes with whisper: `base` for the first 30 s, then `large-v3-turbo`, which on the
reader's phone takes 118 s per 30 s chunk, so the transcript trails playback about fourfold. The
Termux service died or restarted ten times in a day (backlog, "Termux's service keeps dying"), and a
transcript whose Termux dies stays stuck.

**A measured replacement runs in Reader itself.** On 2026-09-28 SenseVoice-Small was compared with
turbo on Chef Wang and the street interview: about as accurate, with different errors (it got
家常菜, 浙江工业大学 and 电子信息 where turbo did not), no invented lines over music, and on the phone's
Chrome a 30 s window in 22 s with 2 threads, faster than playback. The reader prefers transcription
in the app over Termux. Termux then downloads and translates, but no longer transcribes.

**This reverses a rejected alternative.** ADR-0019 rejected speech-to-text in the browser because a
488 MB model at phone-browser speed was the Sapling experience the project exists to avoid. The
model now is 239 MB and keeps ahead of playback, so the reason no longer holds; the reversal is
recorded as an ADR during planning. ADR-0019's own target stays: **the first 20 s readable within
10–20 s** of the video being ready.

**Out of scope**, recorded as foreseen: a slower, better background pass over a finished transcript
(Principle VIII; candidates in the backlog), restoring punctuation, re-transcribing documents that
already exist, other languages, the GPU, and a cloud service.

## Clarifications

### Session 2026-09-28

- Q: Does Termux keep its whisper transcription as a fallback, or is it removed? → A: Removed. Reader
  is the only thing that transcribes; Termux downloads and hands over the video. Until the model is
  downloaded, a subtitle-less video plays without a transcript. Termux's whisper binaries and models
  go from its setup; the scripts stay in git history.
- Q: How does a transcribed video get its LLM line translations from Termux? → A: When the
  transcript is complete, Reader sends it to the Termux service, which translates it as today;
  quick English covers the lines meanwhile. If Termux is not running then, it is sent when it is.
- Q: Does a transcript run only while its video's page is open? → A: No: whenever Reader is open on
  screen, on any page, waiting videos are transcribed one at a time, the one being watched first.
- Q: When is the best thread count measured? → A: Straight after the model download, as part of
  the one-time setup, on a short clip shipped with Reader (about a minute, with progress shown).
- Q: Where is the model downloaded from? → A: Straight from Hugging Face, the repository the
  measurements used, pinned to an exact revision and checked against a stored checksum.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A video without subtitles is transcribed by Reader while I watch (Priority: P1)

The reader downloads a video with Termux as today. It has no Chinese subtitles. Reader opens it as
soon as it is playable and writes the transcript itself: the first lines appear within seconds,
later lines keep ahead of playback, and the words can be looked up as they arrive. When the whole
video is transcribed it becomes an ordinary document, at the same point in playback, and marking
works as for any other video. Termux is not needed for the transcript after the download; it
still translates the lines once the transcript is done (FR-019).

**Why this priority**: It is the feature. Everything else serves it.

**Independent Test**: With the model already on the phone, import the street interview (231 s, no
subtitles). Time the first line after the video becomes playable, check that no line arrives after
playback has reached it, close Termux once the video is in Reader, and check that the finished
transcript becomes a document with the lines at their times.

**Acceptance Scenarios**:

1. **Given** the model is on the device and a subtitle-less video has just been imported, **When**
   the reader opens it, **Then** its first lines are readable within 20 s of the video being
   playable.
2. **Given** a transcript in progress, **When** the reader plays the video from the start at normal
   speed, **Then** each line is on screen before playback reaches it.
3. **Given** a transcript in progress, **When** new lines arrive, **Then** their words can be looked
   up, and marking stays unavailable until the transcript is complete, as today (ADR-0019).
4. **Given** the transcript finishes while the video plays, **When** it becomes a document, **Then**
   playback continues at the same point and marking becomes available.
5. **Given** Termux is closed after the video reached Reader, **When** the transcript runs, **Then**
   it completes without Termux.
6. **Given** a stretch of music or silence, **When** it is transcribed, **Then** no line is written
   for it (nothing invented, as on Chef Wang's outro).

---

### User Story 2 - The speech model is set up once, and then works offline (Priority: P2)

The first time Reader needs to transcribe, it says that it needs a one-time download of about
240 MB and asks before starting. The download can be interrupted and continues where it stopped.
Afterwards the model is kept on the phone: later transcriptions need no network, and the model
survives restarts and app updates. Straight after the download, Reader finds out by itself, in about
a minute, how many threads this phone runs fastest with, and remembers it.

**Why this priority**: Story 1 needs it, but the first time only; it can be tested apart from any
video.

**Independent Test**: On a fresh install, start the download, cut the network halfway, restore it
and see it continue; then with the network off import a subtitle-less video and see it transcribed.
Restart the phone and repeat without a download.

**Acceptance Scenarios**:

1. **Given** no model on the device, **When** a subtitle-less video is opened, **Then** Reader shows
   the download's size and starts only when the reader agrees; the video plays meanwhile.
2. **Given** a download interrupted halfway, **When** the network returns, **Then** it continues
   rather than starting over.
3. **Given** the model downloaded, **When** the phone is offline, **Then** a subtitle-less video is
   transcribed as in Story 1.
4. **Given** the model has been lost (storage cleared), **When** it is next needed, **Then** Reader
   offers the download again; no earned data is affected.
5. **Given** the model has just been downloaded, **When** setup finishes, **Then** Reader has measured
   which thread count is fastest on this phone, in about a minute with progress shown, and uses it
   from then on without asking the reader; the first transcript already runs at that speed.

---

### User Story 3 - A transcript that was interrupted continues where it stopped (Priority: P3)

Android stops Reader when it leaves the screen for long. When the reader comes back, a transcript
that was in progress continues from where it was, not from the start, and the lines already written
are still there.

**Why this priority**: Without it a long video can take several attempts; but a short video
finishes before anything interrupts it.

**Independent Test**: Start the street interview, swipe Reader away halfway, reopen it, and check
that the transcript continues from the last finished stretch with the earlier lines intact.

**Acceptance Scenarios**:

1. **Given** a transcript halfway done, **When** Reader is closed and reopened, **Then** the lines
   written so far are shown and transcription resumes from the last finished stretch.
2. **Given** a transcript was interrupted, **When** it resumes, **Then** no line is duplicated or
   missing at the point where it stopped.

---

### Edge Cases

- **Two videos imported at once**: one transcribes at a time; the other waits and says so. Opening
  the waiting one moves it first; the one that was running keeps its finished stretches and
  resumes after.
- **The reader leaves the video's page**: its transcript continues while Reader is open.
- **A video with Chinese subtitles**: nothing is transcribed, as today.
- **A video shorter than one window**: transcribed as one piece.
- **A long video (an hour)**: transcription keeps ahead of playback throughout, and memory stays
  bounded rather than growing with the video.
- **The download source unreachable or changed** (a different file at the pinned revision): Reader
  says the model could not be fetched and does not use a file that fails the checksum; reading is
  unaffected. Termux fetching it instead stays a possible later route.
- **Storage too full for the model**: Reader says so before downloading, not partway through.
- **A browser without cross-origin isolation, or without threads**: transcription runs on one thread,
  slower than playback, rather than failing.
- **An app update while a transcript runs**: the transcript resumes after the update as in Story 3.
- **Documents transcribed by whisper before this slice**: unchanged; marks point into their text.
- **A Termux not yet updated**, still transcribing: Reader does not wait for or read its transcript;
  it transcribes the video itself. Termux's own work is wasted but harmless.
- **Termux not running when a transcript completes**: the transcript is a document at once; its
  LLM translation starts once Reader reaches the Termux service again (FR-019).
- **The model not yet downloaded**: the video plays without a transcript until it is, then
  transcription starts (Story 2).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Reader MUST transcribe the Chinese speech of an imported video that has no Chinese
  subtitles, on the device, needing no network once the model is present.
- **FR-002**: Termux MUST NOT need to run for a transcript once the video has reached Reader.
  Termux MUST no longer transcribe: it downloads the video and hands it over, and its whisper
  binaries and models are removed from its setup (Clarifications).
- **FR-003**: Lines MUST appear in the open video's reading view as each stretch of audio is
  transcribed; their words MUST be available for lookup as they arrive; marking MUST wait until the
  transcript is complete (ADR-0019).
- **FR-004**: A completed transcript MUST become an ordinary media document by the same path as a
  subtitled video (ADR-0018), with playback continuing at the same point.
- **FR-005**: The audio MUST be transcribed in stretches of at most 30 s, each overlapping the next
  by 2 s and joined at the middle of the overlap, without detecting pauses (measured 2026-09-28:
  longer stretches and pause detection both lost real speech).
- **FR-006**: The first lines MUST arrive quickly even though a full stretch takes longer than that:
  the first stretch MAY be shorter or transcribed differently, per Principle VIII, provided its
  lines are not later replaced by rougher ones.
- **FR-007**: Lines MUST be cut from the timing of the recognised characters, since the transcript
  carries no punctuation: at most about 24 characters a line, breaking at the longest pauses, each
  line timed from its first and last character.
- **FR-008**: Numbers MUST be written as characters (两千到四千), not normalised to digits.
- **FR-009**: The model MUST be downloaded only after the reader agrees, with its size shown, from
  Hugging Face (csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17) at a pinned
  revision, needing no account; an interrupted download MUST resume; the stored model MUST match
  a checksum Reader carries before it is used, and be kept on the device persistently.
- **FR-010**: Reader MUST determine, once per device, the thread count that transcribes fastest, and
  remember it; it MUST NOT assume a fixed count. It MUST do so straight after the model download,
  as part of the one-time setup, on a short clip shipped with Reader, showing progress; and again
  whenever the remembered result is missing or was measured with a different model or runtime.
- **FR-011**: Reader MUST provide the cross-origin isolation that threads require itself, since the
  static host cannot; where isolation or threads are unavailable it MUST transcribe on one thread
  rather than fail.
- **FR-012**: Each transcript MUST record what produced it (model, its version, and the settings of
  FR-005–FR-008), so that a better pass can later replace it and a redo can be told apart.
- **FR-013**: A transcript interrupted by Reader closing, the phone restarting or an app update MUST
  resume from its last finished stretch, keeping the lines already written.
- **FR-014**: Reader MUST show how far a transcript has got, and why it is waiting when it is (the
  model missing, another video first, Reader not open).
- **FR-015**: Transcription MUST run whenever Reader is open on screen, on any page, not only on
  the video's own page. Only one transcript MUST run at a time; the video being watched goes first,
  then the others in the order they were imported. A video imported and not yet opened is
  transcribed too.
- **FR-016**: Reading, playback and lookup MUST stay responsive while a transcript runs.
- **FR-017**: Documents that already exist MUST NOT be changed; this slice transcribes new imports
  only.
- **FR-018**: The media's audio MUST remain kept beside the transcript, as today, so a better model
  can re-derive it (the change register's speech-to-text row).
- **FR-019**: When a transcript is complete, Reader MUST send it to the Termux service so that its
  line translation runs as for a subtitled video (ADR-0021, ADR-0023); if the service is not
  reachable then, Reader MUST send it when it next is, and the lines keep Reader's quick English
  meanwhile. The transcript does not wait on this.

### Key Entities *(include if feature involves data)*

- **Speech model**: the downloaded model files with their version and a check value. Derived: lost,
  it is downloaded again (ADR-0003).
- **Device calibration**: the thread count found fastest on this device, with the timings measured
  and what they were measured with. Derived; measured again if missing or out of date.
- **Transcript in progress**: for one imported video not yet a document, the stretches finished so
  far and their lines, so that it can resume. Derived from the kept audio.
- **Transcript line**: text with start and end times, and the method that produced it (FR-012).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On the reader's phone, with the model present, the first lines of a newly imported
  subtitle-less video are readable within 20 s of the video becoming playable (ADR-0019's target;
  measured with `base` in Termux: 14 s and 22 s, on two videos).
- **SC-002**: The street interview (231 s) is fully transcribed in less time than it takes to play,
  and no line arrives after playback has reached it.
- **SC-003**: On Chef Wang and the street interview, the transcript is at least as accurate as the
  2026-09-28 SenseVoice measurement (scripts/measure/sensevoice/), and invents no line over Chef
  Wang's music-only outro.
- **SC-004**: With Termux closed after the download, a subtitle-less video is transcribed to the end.
- **SC-005**: Interrupted halfway and reopened, a transcript loses at most the stretch that was in
  progress, with no duplicated or missing line at the join.
- **SC-006**: After the one download, a subtitle-less video is transcribed with the network off.
- **SC-007**: While a transcript runs, looking up a word responds as quickly as when none runs.

## Assumptions

- **The reader uses the Chrome install of Reader on the Samsung A71**, where the measurements were
  made. Other phones are served by the calibration (FR-010), not measured in advance.
- **About 240 MB of device storage is available** and persistent storage stays granted, as today.
- **The reader downloads the model on Wi-Fi when they choose**; it is not downloaded unasked.
- **Termux still downloads the video and hands it to Reader** as today (ADR-0022); it may also
  prepare the audio in a form Reader can read cheaply, which planning decides. It also still
  translates lines, now from a transcript Reader sends it (FR-019).
- **Cross-origin isolation can be added without breaking what Reader already fetches** (the Termux
  service on 127.0.0.1, the dictionary and the app's own files); planning verifies this.
- **The measured JS pipeline is the starting point** (scripts/measure/sensevoice/sensevoice.mjs),
  and a new dependency (the ONNX runtime) needs its justification under Principle V at planning.

## Anticipated Changes

Per Constitution Principle V. Ratings follow `docs/anticipated-changes.md`; nothing here licenses a
seam that is not already named there.

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| A slower, better background pass over a finished transcript | high | cheap | Derived. Principle VIII's pattern; candidates are Qwen3-ASR-0.6B or a second decode with offset windows (backlog). Replacing text that marks point into is the hard part, which FR-012's method record prepares for. | Defer |
| Restoring punctuation | medium | cheap | Derived. The transcript has none (number normalisation, which adds it, garbles numbers). A punctuation model could run after it. | Defer |
| Re-transcribing whisper-made documents | medium | cheap | Derived from the kept audio (FR-018), but marks are anchored on the old text, so it meets the same problem as the background pass. | Defer |
| Other languages from the same model (Cantonese, English, Japanese, Korean) | low | cheap | The model supports them; Dutch it does not. Would pass through the language provider. | Ignore |
| The GPU | low | cheap | The full-precision model crashed the phone's Chrome; a smaller one might not. | Ignore |
| A cloud service as an optional tier | medium | cheap | Kept as an option in the backlog (pay-per-use, no subscription); the app must work without it. | Defer |
