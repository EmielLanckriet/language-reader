---
description: "Tasks for 008 — Reader writes its own transcripts"
---

# Tasks: Reader Writes Its Own Transcripts

**Input**: `specs/008-in-app-speech-to-text/`: plan.md, spec.md, research.md (R1–R13),
data-model.md, contracts/speech-worker.md, contracts/reader-service.md, quickstart.md. The measured
code to port is in `scripts/measure/sensevoice/` (`sensevoice.mjs`, `resample.mjs`).

**Tests**: only what the plan names. The window plan and join, and the lines, get invariants
(fast-check); the transcriber gets one resume plumbing test with a fake worker. Each is written
**first** and **made to fail by a mutation** before it's kept (CLAUDE.md). Pipeline fidelity is
checked against the measured module and sherpa-onnx by scripts, not unit tests. Pages, the service
worker and Termux changes are glue: a browser scenario or the phone check, no suite.

**Keep checks short**: a 90 s clip in the browser; the full videos only on the phone (T034).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

- [X] T001 Pin `onnxruntime-web` to exactly `1.30.0` in `package.json` (from ^1.29.0; 1.30.0 is what was measured, R1). Then check that `npm run build` passes `scripts/check-bundle.mjs` and `scripts/copy-ort-runtime.mjs` still finds `ort-wasm-simd-threaded.{wasm,mjs}`, and that `npm test` passes. Then run `npm run verify:browser -- model` (slow: it downloads the segmenter), since the bump also changes the segmenter and quick English
- [X] T002 [P] Generate `src/lib/speech/sense-voice-meta.json` with `python scripts/measure/sensevoice/export_meta.py model.int8.onnx` from the pinned revision `2365baeacb507f821a0c8120fcee3d484dba7a07`. Add a top-level `"revision"` field so code can check that it matches the model it's used with
- [X] T003 [P] Browser fixture: see what `scripts/verify-in-browser/make-fixtures.sh` already produces. Add a 90 s MP4 with Chinese speech and AAC-LC audio as a pending bundle without subtitles, cut locally and not committed if its source is a YouTube video (as the existing media fixtures are handled)

---

## Phase 2: Foundational (blocks all stories)

- [X] T004 [P] Test first in `tests/speech/windows.test.ts`, with fast-check over durations 0.5–4000 s and `first` 5–30. For `windowPlan(duration, {first, length: 30, overlap: 2})`, the keep ranges `[keepFrom, keepTo)` tile `[0, duration)` with no gap or overlap, and each window is at most 30 s long. `keep(plan, index, tokens)` keeps exactly the tokens in that window's range. Then implement `src/lib/speech/windows.ts`, ported from `windowPlan` in `scripts/measure/sensevoice/sensevoice.mjs`, but with the last `keepTo` equal to `duration` rather than `Infinity`, so that plans survive JSON
- [X] T005 [P] Test first in `tests/speech/lines.test.ts`, with fast-check over token lists with non-decreasing times. `lines(tokens)` puts every token in exactly one line, in order; no line is longer than 24 characters; a pause of 0.6 s or more always starts a new line; each line's `from` is its first token's time; and `to` is at or before the next line's `from`. Then implement `src/lib/speech/lines.ts` per R8, plus `toVtt(lines)`
- [X] T006 [P] Port the pipeline to `src/lib/speech/pipeline.ts` from `scripts/measure/sensevoice/sensevoice.mjs`: `fbank`, `lfrCmvn`, `transcribeWindow(ort, session, tokens, meta, samples, offset)` and `parseTokens`. Import the ONNX runtime type only, so the module runs in the worker and in Node. Keep the measured module's comments on why (ITN off, snip edges, samples ×32768), and nothing else
- [X] T007 [P] Port the resampler to `src/lib/speech/resample.ts` from `scripts/measure/sensevoice/resample.mjs`, adding `resampleRange(channels, rate, fromOut, toOut)`. It produces output samples `[fromOut, toOut)` from the input around them, reading up to 32 taps beyond the range, so windows can be resampled one at a time and give exactly the samples a whole-file run would
- [X] T008 Fidelity check: add `scripts/measure/sensevoice/app-check.mjs`, which runs `src/lib/speech/{pipeline,windows,resample}.ts` in Node 24 (type stripping). It feeds Chef Wang and the interview (raw 44.1 kHz stereo float32 from ffmpeg) through `resampleRange` window by window, and compares the result with `transcribeLong` of the measured module on `toSpeech` of the whole file. **Identical text required**, on the same runtime, onnxruntime-node. Stop and report if not
- [X] T009 `src/lib/speech/audio.ts`: open a media file from OPFS and pull the AAC track's samples and `esds` decoder config with mp4box, reusing what `src/lib/media/audio-track.ts` already does. Decode with WebCodecs `AudioDecoder` (codec from the track, `description` from the esds), keeping only the decoded audio the next window needs plus the resampler's margin. Yield `windowSamples(w)` as 16 kHz mono through `resampleRange`. Report "no audio track" or "codec not supported" as reasons, not throws
- [X] T010 `src/lib/speech/speech-worker.ts` per `contracts/speech-worker.md`:
  - load `onnxruntime-web/wasm` from `${base}/ort/`, with `env.wasm.numThreads` set before the first session;
  - `open` reads `speech/<revision>/model.int8.onnx` and `tokens.txt` from OPFS;
  - `transcribe` runs `audio.ts` and `pipeline.ts` over `plan` from `from`, posting `window` messages with the kept tokens (`windows.ts`);
  - `stop` finishes the current window first;
  - `time` decodes a generated signal of the given length for calibration.

  Plus a small typed client, `src/lib/speech/worker-client.ts`, that the transcriber and calibration use
- [X] T011 `src/lib/speech/model.ts` per R5 and data-model.md:
  - pinned URLs for `model.int8.onnx` and `tokens.txt` at revision `2365bae…`;
  - `modelState()` (missing / partial with bytes / present);
  - `downloadModel(onProgress, signal)` in 16 MB Range requests, written at their offsets into OPFS `speech/<revision>/`, with `download.json` updated after each range, so it resumes after an interruption or a reload;
  - SHA-256 checks against `c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51` and `f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc`, then `verified.json`; a failure deletes the file;
  - the runtime files through the existing `downloadInto(RUNTIME_PATHS…)` when missing;
  - old revision folders deleted once the current one is present;
  - a `navigator.storage.estimate()` check that there's room for the remaining bytes before starting (edge case "storage too full")
- [X] T012 Cross-origin isolation per R6:
  - in `src/service-worker.ts`, add `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to every same-origin response `respond()` returns: the precache hit, the network pass-through, the shell fallback and the `/ort/` model-cache hit. Rebuild cached responses, and leave errors and opaque responses alone;
  - in `vite.config.ts`, set `server.headers` and `preview.headers` to the same.

  No reload is added
- [X] T013 Run `npm run verify:browser` with `firstload`, `shell`, `offline` and `readonly` against the build. Extend `shell` in `scripts/verify-in-browser/` to assert that `crossOriginIsolated` is true on the second load and that `firstload` still does not reload. Check the console for sqlite's `opfs` VFS starting its async proxy under isolation (R6); if it does, report what changed before going on

**Checkpoint**: the pipeline in the app matches the measured one exactly; a model can be downloaded, resumed and verified; the app is isolated and storage still works.

---

## Phase 3: User Story 1 — A video without subtitles is transcribed by Reader while I watch (P1) 🎯 MVP

**Goal**: an imported subtitle-less video gets its transcript from Reader, window by window, and
becomes a document; Termux only downloads, and translates afterwards.

**Independent Test**: with the model present, import a subtitle-less video and see the first lines
within 20 s of playable; close Termux and see the transcript finish and become a document; reopen
Termux and see the LLM translation arrive.

- [ ] T014 [US1] `src/lib/media/store.ts`:
  - read and write `transcript.json` in `media/pending/<uuid>/`, written aside and moved into place;
  - write `media.zh.method.json` and `transcript-sent` in `media/<id>/`;
  - `listPending()` returning each job's `importedAt` and duration;
  - all per data-model.md
- [ ] T015 [US1] `src/lib/media/import.ts`: a bundle with media and no Chinese subtitles is pending whether or not it has `transcribing.json` (an older Termux, R11). Record `importedAt`, and tell the transcriber a job exists so it can start loading the model while the import finishes
- [ ] T016 [US1] Test first in `tests/speech/transcriber.test.ts`, with a fake worker client that answers `window` messages from a scripted token list:
  - a job stopped after window k (a `stop`, and separately a new transcriber over the saved `transcript.json`) and then resumed gives exactly the uninterrupted tokens and the same `media.zh.vtt`;
  - a saved method that differs from the current one starts from window 0.

  Then implement `src/lib/speech/transcriber.ts` per R7:
  - a module singleton that lists pending jobs and orders them (`prefer(job)` first, then by `importedAt`);
  - one job at a time, switching jobs only between windows;
  - `transcript.json` saved after every window;
  - on the last window: build the lines (`lines.ts`), then `createMediaDocument(title, vtt, files + media.zh.method.json)`, `removePending`, and publish `done {documentId}`;
  - threads from `speech/calibration.json` when it's valid, 1 otherwise;
  - states per data-model.md, published to subscribers
- [ ] T017 [US1] Start the transcriber in the root layout's `$effect` in `src/routes/+layout.svelte`, beside `startCopying()`. It runs on every page and does nothing when no job is pending or the model is missing
- [ ] T018 [US1] `src/routes/live/[job]/+page.svelte`:
  - replace the Termux polling (`poll`, `transcribing.json` URLs, `chunk.expected`, `reachable`) with a subscription to the transcriber, calling `prefer(job)`;
  - lines come from its tokens through `lines.ts`, and each new line is segmented with the fallback analyzer as today;
  - quick English stays as it is;
  - show the FR-014 states ("Waiting for the speech model", "Behind another video", "Transcribing: 1:20 of 3:51");
  - on `done`, go to `/read/<id>?t=<floor(currentTime)>` as `finish()` did, and remove `finish()`'s own document creation
- [ ] T019 [US1] `src/routes/+page.svelte` (the library): show a pending job's transcriber state instead of the service's `transcribing` flag
- [ ] T020 [US1] FR-019, Reader side, in `src/lib/speech/transcriber.ts`:
  - after a document is created, `PUT` its `media.zh.vtt` to `http://127.0.0.1:8765/downloads/<job>/media.zh.vtt` (the job from `meta.json`, `jobOf`), and write `transcript-sent` on a 204;
  - retry unsent documents when the transcriber starts and every 5 minutes, as `src/lib/backup/scheduler.ts` does;
  - on a 404 (the job is gone from Termux) write `transcript-sent` as `{"gone": true}` and stop retrying, per `contracts/reader-service.md`;
  - a failure never blocks the transcript
- [ ] T021 [P] [US1] `scripts/termux/reader-service.py` per `contracts/reader-service.md`:
  - `PUT /downloads/<job>/media.zh.vtt` writes the file aside and renames it, then starts `translate.py` detached unless `translate.lock` is held (204/404/400);
  - `GET /downloads` drops `transcribing`.

  One test in `scripts/termux/test_service.py`: a PUT for an existing job stores the file and a second PUT does not start a second translation
- [ ] T022 [P] [US1] `scripts/termux/translate.py`: in `source()`, a present `media.zh.vtt` with no `transcribing.json` is complete. Take and release `translate.lock`. Add one case to `scripts/termux/test_translate.py`
- [ ] T023 [P] [US1] `scripts/termux/termux-url-opener`: stop writing `transcribing.json` and running `transcribe.py` (lines 72–79, 98–99); a bundle without subtitles is just media. Delete `scripts/termux/transcribe.py` and `scripts/termux/test_transcribe.py`
- [ ] T024 [P] [US1] `scripts/termux/setup.sh` and `scripts/termux/build-binaries.sh`: stop installing `whisper-cli`, `ggml-base.bin` and `ggml-large-v3-turbo-q5_0.bin`; remove them and `~/.whisper/chunk-seconds.json` where they exist; build llama only. Keep the Qwen model under `~/.whisper/` where `translate.py` expects it
- [ ] T025 [US1] Add a `transcribe` scenario to `scripts/verify-in-browser/`: with the model downloaded (slow, like `model`, from Hugging Face), import the T003 fixture, check that lines appear on the live page while it plays, that it becomes a document with cues, and that `media.zh.method.json` is there. Add it to the README's table

**Checkpoint**: US1 works in a browser end to end; Termux no longer transcribes.

---

## Phase 4: User Story 2 — The speech model is set up once, and then works offline (P2)

**Goal**: a one-time download the reader agrees to, resumable, then a calibration of about a
minute; offline transcription afterwards.

**Independent Test**: on a fresh profile, start the download, cut the network, restore it and see it
continue; see calibration pick a thread count; transcribe with the network off.

- [ ] T026 [US2] The download offer:
  - on the live page when the model is missing, and under More: "Transcribing needs a one-time download of 240 MB", with Download and Not now, and progress while it runs;
  - it resumes by itself when `online` fires or Reader starts again with a partial download;
  - storage-full and source-unreachable messages per the spec's edge cases;
  - a component in `src/lib/ui/SpeechModel.svelte`, used from `src/routes/live/[job]/+page.svelte` and the More page
- [ ] T027 [US2] `src/lib/speech/calibrate.ts` per R9:
  - once the model is verified and `crossOriginIsolated` is true, for 1, 2 and 4 threads (never above `hardwareConcurrency`) a fresh worker opens the session and times a generated 10 s signal twice, keeping the second;
  - writes `speech/calibration.json` with the timings, revision, runtime, cores and `isolated`;
  - publishes the state `calibrating {step, of}` for T026's component;
  - re-runs when the stored result is invalid (data-model.md);
  - the transcriber waits while it runs
- [ ] T028 [P] [US2] `src/routes/diagnostics/+page.svelte`: show `crossOriginIsolated`, the model revision and whether it's verified, the calibration's timings and chosen count, and each pending job's state. It's what the phone check reads over CDP

**Checkpoint**: from a fresh install the model can be set up, and transcripts run at the calibrated speed.

---

## Phase 5: User Story 3 — A transcript that was interrupted continues where it stopped (P3)

**Goal**: closing Reader, a restart or an update costs at most the window in progress.

**Independent Test**: start a transcript, reload the page halfway (in the browser) or swipe Reader
away (on the phone), reopen, and see it continue with the earlier lines intact and nothing
duplicated at the join.

- [ ] T029 [US3] `src/lib/speech/transcriber.ts`:
  - at start, resume every pending job from its `transcript.json` (T016's rule);
  - restart the worker once if it errors or is lost mid-window, and mark the job failed with the reason if it fails again on the same window;
  - make sure a job the live page has left keeps running (FR-015).

  Extend the `transcribe` scenario (T025) to reload halfway and check that the finished cues equal an uninterrupted run's

**Checkpoint**: all three stories work; the slice is ready for the phone.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T030 [P] Docs (the register's new entries from this spec's Anticipated Changes were added during analysis, 2026-09-28):
  - `docs/adr/0019-transcripts-stream-from-termux.md`: a status line "Superseded in part by ADR-0029 (transcription moved into Reader)";
  - `docs/anticipated-changes.md`: revise the speech-to-text row (built in Reader, spec 008, ADR-0029; the audio is still the retained input);
  - `scripts/termux/README` or the setup notes, if any mention whisper
- [ ] T031 [P] `npm run lint`, `npm run check` and `npm test` pass. For each test kept in `tests/speech/`, mutate the code it covers once and see it fail (CLAUDE.md); note the mutations in the commit message
- [ ] T032 Deploy, then run the Termux setup on the phone (`setup.sh`). Check that the whisper files are gone and about 720 MB is freed
- [ ] T033 Phone check, batched per `quickstart.md` §4 (stay-awake on, driven over adb and CDP): the update and isolation; the download with an interruption; calibration; SC-001, SC-002 and SC-007 on the street interview; SC-004 and FR-019 with Termux closed and then reopened; SC-005 and SC-003 on Chef Wang, swiped away halfway; SC-006 offline. Record the time per window with quick English running beside it (R13). Also one long video (30–60 min): it catches up with playback and stays ahead, and Chrome's memory, read over CDP, stays flat rather than growing with the video (edge case "a long video")
- [ ] T034 If T033 shows the transcript falling behind playback because of quick English (R13), make quick English wait while a window decodes (`src/lib/translation/quick.ts`), and re-measure. Otherwise note in research.md R13 that it didn't
- [ ] T035 Record T033's numbers in `specs/008-in-app-speech-to-text/spec.md` (a "Phone check" note, as 006 and 007 have), in the backlog entry "Speech-to-text in Reader with SenseVoice" (move it to built), and in ADR-0029's Consequences where they differ from the plan's estimates

---

## Dependencies & Execution Order

- **Setup (T001–T003)**: T001 first (the runtime version everything measures against); T002 and T003 in parallel.
- **Foundational (T004–T013)**:
  - T004–T007 in parallel;
  - T008 needs T004, T006 and T007;
  - T009 needs T007;
  - T010 needs T006, T009 and T004;
  - T011 is independent;
  - T012 is independent, and T013 needs it.
- **US1 (T014–T025)**:
  - needs Phase 2;
  - T014 → T015 → T016 → (T017, T018, T019, T020);
  - T021–T024 are Termux-side and parallel to all of it;
  - T025 needs T016–T018 and T003.
- **US2 (T026–T028)**: needs T011 and T010; T027 feeds T016's thread count, but US1 works without it (1 thread).
- **US3 (T029)**: needs T016.
- **Polish**: T030 and T031 anytime after their code; T032–T035 last, in order.

## Parallel Examples

- Phase 2: T004 (windows), T005 (lines), T006 (pipeline), T007 (resampler), T011 (model store) and T012 (service worker) touch different files.
- US1: T021, T022, T023 and T024 (Termux) alongside T016–T020 (Reader).

## Implementation Strategy

1. **Foundational first, and stop at T008 if the port is not exact**: an app pipeline that differs from the measured one would make every phone number meaningless.
2. **MVP = US1** with the model downloaded by hand (or through T011's function) and 1 thread; it already replaces Termux's transcription.
3. **US2** adds the download offer and calibration (2 threads on the A71). **US3** is a small addition on T016's persistence.
4. **One deploy, one batched phone check** (T033), per CLAUDE.md: the phone round-trip is the slow part.
