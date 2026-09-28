# ADR-0029: Reader Transcribes In The Browser; Termux Only Downloads And Translates

**Status**: Accepted
**Date**: 2026-09-28
**Relates to**: spec 008; supersedes ADR-0019's transcription in Termux and reverses its rejection
of speech-to-text in the browser; amends ADR-0017 (what Termux is needed for); Principle VIII

## Context

ADR-0019 put whisper in Termux and rejected it in the browser: "a 488 MB model in a phone browser
is the Sapling experience this exists to avoid". By 2026-09-27 the Termux transcript was
`large-v3-turbo`, 118 s per 30 s chunk on the reader's phone, trailing playback about fourfold. The
Termux service died ten times in a day, and a transcript whose Termux dies stays stuck.

Measured on 2026-09-28 (backlog, "Speech-to-text in Reader with SenseVoice";
`scripts/measure/sensevoice/`): SenseVoice-Small is 239 MB int8, about as accurate as turbo on the
two reference videos, and in the phone's Chrome it decodes a 30 s window in 22 s with 2 threads.
The phone's Chrome also decodes the videos' AAC in a worker, and the resampled audio equals the
laptop's.

## Decision

**Reader transcribes; Termux downloads and translates.**
- An app-wide transcriber, running whenever Reader is open, decodes the video's own audio and
  transcribes it with SenseVoice-Small through onnxruntime-web: a 10 s first window, then 30 s
  windows every 28 s, joined at the middle of the overlap, with no pause detection and ITN off.
- The thread count is measured once per device. The service worker supplies the cross-origin
  isolation that threads need.
- The transcript is saved after every window, resumes after an interruption, and becomes a document
  through ADR-0018's path when done. Then it's sent to the Termux service, which runs `translate.py`
  on it.
- Termux's whisper, its models and `transcribe.py` are removed.

ADR-0017's "Termux is needed only while an import is finishing" (as amended by ADR-0019) becomes:
**Termux is needed for the download, and later for the LLM translation, never for the transcript.**

## Alternatives Rejected

- **Keeping whisper in Termux, faster.** `base` throughout is fast and mishears (新资 for 薪资); turbo
  trails fourfold. Either way the transcript depends on the process that keeps dying.
- **Keeping Termux's whisper as a fallback.** Two transcription paths to keep working, for a
  one-time model download and one phone that is fast enough.
- **Termux writing a 16 kHz WAV for Reader.** It's the measured input exactly, but it keeps Termux
  in the transcript. Decoding in Reader measured equivalent.
- **sherpa-onnx's own WebAssembly build.** It has no threaded onnxruntime (29–38 s per window).
- **Longer windows, or pause detection.** Both lost real speech on the street interview.
- **A cloud service.** It can lapse. It stays an optional tier in the backlog.

## Consequences

- **Easier**:
  - A transcript doesn't depend on Termux staying alive.
  - Termux loses about 720 MB of whisper binaries and models.
  - Old videos become re-transcribable from their kept media.
  - Each transcript records its method (`media.zh.method.json`), so a better pass can replace it
    later (Principle VIII).
- **Harder**:
  - A one-time 239 MB download, plus a one-minute calibration.
  - The transcript trails playback for about its first two minutes, because at 0.73× real time it
    can only catch up.
  - Cross-origin isolation now constrains everything Reader loads: a future cross-origin resource
    needs CORS or CORP.
  - A brand-new install transcribes on one thread until its second start.
- **Revisit if**:
  - another phone calibrates slower than playback;
  - quick English or the segmenter slows the transcriber below playback on the phone (research R13);
  - Hugging Face's pinned revision disappears, in which case Termux fetching the model becomes the
    route.
