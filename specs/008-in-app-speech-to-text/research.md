# Research: Reader Writes Its Own Transcripts

Decisions for spec 008, each with what it rests on. Measurements are from 2026-09-28 unless noted;
the harnesses are in `scripts/measure/sensevoice/` and the backlog entry "Speech-to-text in Reader
with SenseVoice" holds the model comparison.

## R1. The model and how it runs

**Decision**: SenseVoice-Small int8 (239,233,841 bytes), run through onnxruntime-web **1.30.0**
(the app has 1.29.0; bump and pin exactly, since 1.30.0 is what was measured), with the pipeline
of `scripts/measure/sensevoice/sensevoice.mjs` ported into `src/lib/speech/`: kaldi fbank (80 bins,
25/10 ms, hamming, snip edges, no dither, samples x 32768), frame stacking 7/6, CMVN from the
model's metadata, CTC greedy decode, the first four tokens (language, emotion, event, ITN) dropped,
per-token times at 60 ms. Language fixed to Chinese, ITN off.

**Rationale**: verified against sherpa-onnx: features within 1e-4 of kaldi-native-fbank, text equal
except at near-tied tokens (a gap of 0.09 where the median is 9.8), which any change of runtime or
CPU flips.

**Alternatives**: sherpa-onnx's WebAssembly build (no threaded onnxruntime; 29–38 s per window);
Fun-ASR-Nano (worse, or slow and inventive); turbo and cloud services (backlog).

## R2. Threads

**Decision**: the session runs with the calibrated thread count (R9), default 1 until calibrated.
The worker loads onnxruntime-web with `env.wasm.numThreads` set before the first session, since it
is fixed at initialisation; changing it means a new worker.

**Rationale**: on the A71's Chrome, per 30 s window: 1 thread 38.6 s, 2 threads 22.0 s, 3 threads
48.8 s, 4 threads 40.4 s; spinning off made 2 threads 28.8 s. Two fast cores and six slow ones, and
onnxruntime waits for the slowest thread on every op. A spin test in 1–8 workers confirmed the
platform itself scales (`phone/cores.html`).

## R3. Windows, and why the transcript trails at first

**Decision**: a first window of 10 s, then 30 s windows starting every 28 s, each keeping its
tokens from the middle of the overlap before it to the middle of the overlap after it
(`windowPlan` in the measured module). No pause detection. Windows are decided up front from the
duration, so a resumed transcript cuts at the same places.

**Rationale**: SenseVoice's README gives 30 s as the input limit; 45–90 s windows dropped phrases,
Silero VAD at 0.5/0.3/0.2 either skipped real speech or found no pauses. The 2 s overlap keeps
words cut at a boundary whole. A 10 s first window loses nothing measurable (its text equals the
30 s window's) and decodes in about a third of the time, so the first lines come about 7 s after
transcription starts on the phone.

At 0.73 x real time the transcript cannot start ahead of playback. Played at once, window 2
(8–38 s) is ready at about 29 s though its lines start at 9 s; each 30 s window then gains 6 s, and
from window 6 (about two minutes in) lines are ready before playback reaches them. SC-002 says
exactly that. Smaller early windows would narrow the early gap (20 s windows: at most about 13 s)
at some cost in context; not done unless the early gap matters in use.

## R4. Audio comes from the video, decoded in Reader

**Decision**: Reader decodes the video's own AAC audio in the transcription worker: samples from
mp4box (already a dependency, `src/lib/media/audio-track.ts`), WebCodecs `AudioDecoder`, then a
downmix and a Kaiser-windowed sinc resampler to 16 kHz (`scripts/measure/sensevoice/resample.mjs`,
matching ffmpeg's defaults: cutoff 0.97, beta 9, 32 taps a side, one filter per phase). Decoded and
resampled window by window, not up front. Termux prepares nothing.

**Rationale**: decided with the reader, to rely on Termux as little as possible; it also leaves old
videos re-transcribable from their kept media. Measured:
- The phone's Chrome decodes the videos' AAC-LC (44.1 kHz stereo) in a worker: 231 s of audio in
  4.1 s, resampling 5.0 s, and the result equals the laptop's to 142 dB (float rounding).
- Against ffmpeg's 16 kHz, the resampler gives an identical Chef Wang transcript and 19 one-character
  changes on the interview. The control, ffmpeg's own soxr resampler against its default, gives 29,
  so this is ordinary near-tie scatter, not a worse input.
- Up front, 9 s for 231 s would be 2.5 minutes for an hour, delaying the first lines: hence by window.

**Alternatives**: a 16 kHz WAV written by Termux (the measured input exactly; rejected to keep
Termux out of transcription); `decodeAudioData` (main thread only, whole file in memory).

## R5. Where the model is kept, and how it is fetched

**Decision**: fetched from Hugging Face at the pinned revision
`csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17@2365baeacb507f821a0c8120fcee3d484dba7a07`
(`model.int8.onnx`, `tokens.txt`), in ranges of 16 MB written at their offsets into an OPFS file
`speech/<revision>/model.int8.onnx`, with the bytes done recorded after each range, so an
interrupted download resumes. When complete, SHA-256 is checked against
`c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51` (and `tokens.txt` against
`f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc`) and a `verified` record written;
a file that fails is deleted. The CMVN and ids are shipped as a JSON generated by
`export_meta.py` (12 KB), keyed by the same revision. The runtime files come through the existing
`MODEL_CACHE` path (`RUNTIME_PATHS`), as for the other two models.

**Rationale**: checked from the laptop with the app's origin: the pinned URL redirects to Hugging
Face's CDN with `Access-Control-Allow-Origin` at both steps, and a Range request returns `206` with
`Content-Range`. The existing `downloadInto` streams a whole file into the Cache API, which cannot
be appended to, so it cannot resume; the other two models are small enough not to need it.

**Alternatives**: parts as separate Cache API entries (needs concatenation into one 239 MB buffer
anyway); Termux fetching it (a later route if Hugging Face changes, spec edge case).

## R6. Cross-origin isolation

**Decision**: the service worker adds `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp` to every same-origin response it returns (precache
hits, network pass-throughs, the shell fallback, `/ort/` from the model cache), rebuilding cached
responses since they are immutable; worker scripts included, since a dedicated worker needs COEP on
its own script. Vite's `server.headers` and `preview.headers` send the same in development. **No
reload is added to gain isolation**: the installed Reader becomes isolated at the reload that
accepting the update already does; a brand-new install from its second start. Until then the
transcriber runs on 1 thread (FR-011).

**Rationale**: every cross-origin fetch the app makes is CORS mode (the Termux service sends
`Access-Control-Allow-Origin: *`, Hugging Face sends it too), media plays from `blob:` URLs, and
there are no iframes, external fonts or images, so require-corp breaks nothing found. require-corp
is what the phone measurements ran under. The `firstload` browser check exists because a first
visit reloading itself once broke three other scenarios, so a reload for isolation is not added.

**Risk to check**: with SharedArrayBuffer available, `sqlite3InitModule` may also install its plain
`opfs` VFS and start `sqlite3-opfs-async-proxy.js`; the app uses `opfs-sahpool`. The storage
browser checks run under isolation before shipping.

## R7. One transcriber for the whole app

**Decision**: a module singleton, `transcriber`, started from the root layout like the backup timer.
It lists pending jobs from OPFS `media/pending/`, orders them (the one a live page asks for first,
then by import time), and runs one at a time in a single `speech-worker`. It persists after every
window, turns a finished transcript into a document itself (`createMediaDocument`, the existing
path), removes the pending folder, and tells subscribers. The live page subscribes instead of
polling Termux, and moves to `/read/<id>?t=<time>` when its job becomes a document.

**Rationale**: FR-015 (any page, one at a time, watched first) and FR-013 (resume) need the queue
outside any page. The live page's finish logic moves with it, since a transcript may now finish
while nobody watches.

## R8. Lines

**Decision**: lines are cut from the kept tokens: a new line after a pause of 0.6 s or more between
tokens, or at the longest pause once a line reaches 24 characters, each line from its first token's
time to the next line's start (or its last token plus 0.5 s). Computed from tokens when shown and
when writing the finished `media.zh.vtt`, so it can change without re-transcribing.

**Rationale**: with ITN off the text has no punctuation; the Termux transcriber cut at clause
punctuation or 24 characters (ADR-0019, 2026-09-26 amendment), and subtitle lines on the videos
measured run 10–25 characters. The 0.6 s pause is a starting value to be checked on the two videos.

## R9. Calibration

**Decision**: straight after the model is verified, in an isolated session: for 1, 2 and 4
threads, a fresh worker creates a session and decodes a generated 10 s signal twice, timing the
second. The fastest count is stored in OPFS `speech/calibration.json` with the timings, the model
revision, the onnxruntime version and `hardwareConcurrency`; it is measured again when any of those
differ, or when it was measured without isolation. If the session is not isolated at download time,
calibration waits for the next isolated start and transcription uses 1 thread meanwhile.

**Rationale**: the encoder's cost depends on the audio's length, not its content, so a generated
signal times it as well as speech and ships nothing (no clip to license). Timed per the phone
figures: about 13, 7 and 13 s per 10 s decode plus about 10 s of session creation each, so about a
minute with progress shown, as clarified.

## R10. Translation after the transcript (FR-019)

**Decision**: the reader service gets `PUT /downloads/<job>/media.zh.vtt`: it writes the file aside
and renames it, then starts `translate.py <job>` unless it is already running for that job (a lock
file). `translate.py` treats a present `media.zh.vtt` with no `transcribing.json` as complete, as
for a downloaded track. Reader records, per document, whether the transcript has been sent
(`transcript-sent` beside the media files), and the transcriber retries unsent ones when it
starts and every 5 minutes, as the backup does. The read page's existing `followTranslation` then
finds `translate.json` as today.

**Rationale**: the least change: `translate.py` already translates a downloaded Chinese track, and
already waited for Termux's transcript to be complete before starting (ADR-0019, 2026-09-26).

## R11. Removing Termux's transcription

**Decision**: `termux-url-opener` no longer writes `transcribing.json` or runs `transcribe.py`; a
bundle without Chinese subtitles is simply media. `transcribe.py` and `test_transcribe.py` are
deleted; `setup.sh` stops installing `whisper-cli` and the whisper models and removes those already
installed (about 720 MB); `build-binaries.sh` builds llama only. The reader service drops the
`transcribing` flag from `/downloads`. Reader treats a bundle with `transcribing.json` (an older
Termux) the same as one without subtitles: it transcribes from the media.

**Rationale**: clarified (option A). The old files stay in git history.

## R12. What the transcript records (FR-012)

**Decision**: the method is `{model: 'sense-voice-small-int8', revision, runtime: 'onnxruntime-web
1.30.0', window: {first: 10, length: 30, overlap: 2}, itn: false, resampler: 'kaiser-sinc-0.97'}`,
stored in the pending folder's `transcript.json` and, when done, as `media.zh.method.json` beside
`media.zh.vtt` in `media/<id>/`. A resumed transcript continues only if its recorded method equals
the current one; otherwise it starts again from the beginning.

**Rationale**: Principle VIII requires each piece to record its method. A file beside the media
rather than a column keeps this out of the database and its migrations (the irreversible surface),
and the transcript itself is derived.

## R13. What competes with the transcriber

**Suspected, not measured**: Reader's quick English runs in its own single-threaded worker while
lines arrive, and the segmenter may run on the main thread; on two fast cores either could slow the
transcriber. Measured in the phone check (quickstart); if SC-002 fails because of it, quick English
waits while a window decodes.
