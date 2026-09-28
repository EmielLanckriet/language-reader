# Implementation Plan: Reader Writes Its Own Transcripts

**Branch**: `008-in-app-speech-to-text` (worked on `main`, as 004–007) | **Date**: 2026-09-28 |
**Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/008-in-app-speech-to-text/spec.md`

## Summary

Reader transcribes videos without Chinese subtitles itself:
- an app-wide transcriber decodes the video's own audio (mp4box + WebCodecs) and resamples it to
  16 kHz;
- it runs SenseVoice-Small (int8, 239 MB, downloaded once from a pinned Hugging Face revision and
  checked) through onnxruntime-web, with the thread count calibrated per device and cross-origin
  isolation supplied by the service worker;
- it streams lines into the live page window by window (10 s first, then 30 s with a 2 s overlap),
  saving after each window so it can resume;
- a finished transcript becomes a document through the existing path, then goes to the Termux
  service for the LLM translation.

Termux's whisper is removed. Every choice was measured on 2026-09-28 ([research.md](research.md);
backlog; `scripts/measure/sensevoice/`), including on the phone. [ADR-0029](../../docs/adr/0029-reader-transcribes-in-the-browser.md)
records the reversal of ADR-0019.

## Technical Context

**Language/Version**: TypeScript (Svelte 5, SvelteKit 2, Vite 8); Python 3 in Termux for the
service and translation.

**Primary Dependencies**:
- Existing: onnxruntime-web, bumped from 1.29.0 to **1.30.0 pinned** (the measured version; the
  segmenter and quick translator use it too); mp4box 2.4.1 (demuxing, as `audio-track.ts` does).
- Platform: WebCodecs `AudioDecoder`, OPFS, SharedArrayBuffer under cross-origin isolation.
- **No new dependency.**

**Storage**:
- OPFS: `speech/` (model, calibration) and `media/pending/<uuid>/transcript.json`. All derived.
- The database is untouched: no migration. A document is created only through the existing
  `createMediaDocument`.

**Testing**: vitest + fast-check for the pure parts (window plan and join, lines), and one resume
plumbing test with a fake worker. Pipeline fidelity is checked by the measurement scripts against
sherpa-onnx, not by unit tests. Browser: `verify:browser` (existing scenarios plus `transcribe`).
Phone: the batched check in [quickstart.md](quickstart.md).

**Target Platform**: Chrome on Android (Samsung A71: 2 fast + 6 slow cores, 5.6 GB); the laptop's
Chrome for development.

**Project Type**: an installable, offline web app (PWA) with a Termux companion.

**Performance Goals** (from the spec, measured feasible):
- first lines within 20 s of playable;
- the transcript finishes faster than playback and is ahead of it from about two minutes in;
- 2 threads at about 22 s per 30 s window on the A71.

**Constraints**:
- reading stays offline and responsive;
- memory bounded by one window of decoded audio plus the model;
- no automatic reload on a first visit (`firstload`);
- every resource Reader loads must stay compatible with COEP `require-corp`.

**Scale/Scope**: one reader. Videos of a few minutes to an hour. One transcript at a time.

## Constitution Check

*GATE: checked before research and again after design; passes both times.*

| Principle | How this plan meets it |
|---|---|
| I. Ships to the phone | A batched phone check ends the slice (quickstart §4), covering every SC. |
| II. Test-first on state transitions | None of the mandated areas is touched: no status, merge/split, replay, scheduling or Anki payload. Segmentation of the new lines uses the existing analyzer unchanged. The derived parts are tested for invariants only (window tiling, line coverage), and the orchestration gets one plumbing test (resume). The ceiling half is honoured too: no suite for glue. |
| III. Anki read, never written | Not touched. |
| IV. Vertical slices | Termux (download, service, translation), worker, storage, transcriber, live page, library and settings, all in one slice. |
| V. Modular by seam, flat within | No seam added. The transcriber has one engine and no pluggable interface: the register rates a better background pass as Defer, so FR-012's method record is data, not a seam. No new dependency. The onnxruntime bump is justified by it being the measured version. |
| VI. Decisions recorded | ADR-0029 (reverses ADR-0019's rejection, amends ADR-0017). ADR-0019 gets a status note. The register's speech-to-text row is revised when built. |
| VII. Readable over clever | The pipeline is ported as the measured module reads, with comments only for decisions (why 30 s, why no ITN, why 2 threads). |
| VIII. Fast first, better in the background | A 10 s first window gives lines in about 7 s. Each transcript records its method, so a later better pass can replace it and never be overwritten by a rougher one. The better pass itself is out of scope. |
| No server, nothing that lapses | The model is a public file at a pinned revision on a free host, checked by checksum. The cloud tier isn't used. |

**Complexity Tracking**: nothing to justify.

## Project Structure

### Documentation (this feature)

```text
specs/008-in-app-speech-to-text/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R13, the decisions and their measurements
├── data-model.md        # OPFS files, states, invariants
├── quickstart.md        # laptop, browser and phone checks
├── contracts/
│   ├── speech-worker.md     # messages to and from the worker
│   └── reader-service.md    # PUT of the finished transcript; translate.py trigger
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
src/lib/speech/                  # new
├── pipeline.ts                  # fbank, frame stacking, CMVN, CTC decode (port of the measured module)
├── sense-voice-meta.json        # CMVN and ids for the pinned revision (export_meta.py)
├── windows.ts                   # windowPlan and the keep-range join
├── lines.ts                     # tokens → lines (R8)
├── resample.ts                  # downmix + Kaiser-sinc resampler (port of resample.mjs)
├── audio.ts                     # mp4box samples → AudioDecoder → 16 kHz, window by window
├── model.ts                     # pinned URLs, resumable download into OPFS, checksum, presence
├── calibrate.ts                 # thread-count trials in fresh workers (R9)
├── speech-worker.ts             # contract: contracts/speech-worker.md
└── transcriber.ts               # app-wide queue, persistence, finishing, sending to Termux

src/service-worker.ts            # COOP/COEP on every same-origin response (R6)
vite.config.ts                   # the same headers for dev and preview
src/routes/+layout.svelte        # starts the transcriber
src/routes/live/[job]/+page.svelte   # subscribes to the transcriber instead of polling Termux
src/routes/+page.svelte          # library: a job's transcriber state instead of `transcribing`
src/lib/media/import.ts          # a bundle without Chinese subtitles is pending, with or without transcribing.json
src/lib/media/store.ts           # transcript.json, media.zh.method.json, transcript-sent
package.json                     # onnxruntime-web 1.30.0 pinned

scripts/termux/
├── termux-url-opener            # no transcribing.json, no transcribe.py
├── reader-service.py            # PUT /downloads/<job>/media.zh.vtt → translate.py; drop `transcribing`
├── translate.py                 # a present media.zh.vtt without transcribing.json is complete
├── setup.sh, build-binaries.sh  # no whisper; remove installed whisper models
└── transcribe.py, test_transcribe.py   # deleted

tests/speech/                    # windows, lines, resume
scripts/verify-in-browser/       # a `transcribe` scenario; isolation asserted in `shell`
docs/adr/0029-…, docs/adr/0019-… (status note), docs/anticipated-changes.md (speech-to-text row)
```

**Structure Decision**: one new module, `src/lib/speech/`, flat within (Principle V), beside
`src/lib/translation/` and `src/lib/analyzer/`, which own the other two on-device models. The
transcriber is started where the backup timer is, in the root layout.

## Complexity Tracking

None.
