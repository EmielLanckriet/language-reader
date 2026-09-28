# Data Model: Reader Writes Its Own Transcripts

Everything here is **derived** (ADR-0003): recomputable from the kept video and the model, so none
of it goes into the database and no migration is added. The database is reached only through the
existing `createMediaDocument` when a transcript is complete, exactly as for a subtitled video.

## Speech model — OPFS `speech/<revision>/`

| File | Contents |
|---|---|
| `model.int8.onnx` | 239,233,841 bytes, written range by range at their offsets |
| `tokens.txt` | 315,894 bytes |
| `download.json` | `{revision, files: {name: {size, done}}}`: bytes written so far per file, updated after each 16 MB range |
| `verified.json` | `{revision, sha256: {name: hex}, at}`: written only after both files match the carried checksums |

- **Present** means `verified.json` exists for the current revision. Anything else is missing, and
  a partial download resumes from `download.json`.
- **Lifecycle**: missing → downloading (resumable) → verifying → present. A failed check deletes the
  file and returns to missing. A different revision in a later build makes the old folder rubbish,
  deleted once the new one is present.
- Alongside, not in OPFS: the runtime files stay in `MODEL_CACHE` (`RUNTIME_PATHS`), shared with the
  other models, and the CMVN/ids are a JSON in the source keyed by revision.

## Device calibration — OPFS `speech/calibration.json`

```json
{ "threads": 2, "timings": { "1": 13100, "2": 7300, "4": 13400 },
  "revision": "2365bae…", "runtime": "1.30.0", "cores": 8, "isolated": true, "at": "…" }
```

- **Valid** when revision, runtime and cores equal the current ones and `isolated` is true.
  Otherwise it's measured again at the next isolated start (R9), and transcription uses 1 thread
  meanwhile.

## Transcript in progress — OPFS `media/pending/<uuid>/transcript.json`

Beside the existing pending files (`media.*`, `meta.json`, and `transcribing.json` from an older
Termux, which is ignored).

```json
{ "version": 1,
  "method": { "model": "sense-voice-small-int8", "revision": "2365bae…",
              "runtime": "onnxruntime-web 1.30.0",
              "window": { "first": 10, "length": 30, "overlap": 2 },
              "itn": false, "resampler": "kaiser-sinc-0.97" },
  "duration": 230.8,
  "importedAt": "2026-09-28T…",
  "windowsDone": 3,
  "tokens": [["上", 0.24], ["海", 0.48], …] }
```

- **Written** after each window, aside and then renamed, so a crash leaves the previous whole
  version.
- **Resume**: continue at window `windowsDone` of `windowPlan(duration, method.window)`, but only if
  `method` equals the current method. Otherwise start again from window 0.
- **Invariant**: token times are non-decreasing, and every token lies in the keep range of exactly
  one of the first `windowsDone` windows (R3).
- **Ends** when `windowsDone` equals the plan's length. Then the lines (R8) are written as
  `media.zh.vtt`, the document is created, and the pending folder is removed.

## Transcript line (derived when shown)

`{text, from, to}` cut from the tokens by R8, never stored separately from them. The finished
`media.zh.vtt` holds the same lines, so the document's cues are those lines.

## Finished media — `media/<id>/` additions

| File | Contents |
|---|---|
| `media.zh.method.json` | the `method` above: which model and settings wrote this transcript (FR-012) |
| `transcript-sent` | present once the Termux service accepted the transcript for translation (FR-019). Absent means retry. |

## Transcriber state (in memory, published to subscribers)

Per job: `waiting-for-model` · `downloading {received, total}` · `calibrating {step, of}` ·
`queued {behind}` · `loading` · `transcribing {through, total}` · `finishing` · `done {documentId}` ·
`failed {reason}`. The live page and the library show it (FR-014).
