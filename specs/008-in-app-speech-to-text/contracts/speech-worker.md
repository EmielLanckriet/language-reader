# Contract: the speech worker

One module worker, `src/lib/speech/speech-worker.ts`, owned by the transcriber. It loads
onnxruntime-web itself, from `${base}/ort/`, with `env.wasm.numThreads = threads`, set before the
first session because onnxruntime fixes it then. So a different thread count means a new worker.
It reads the model and the media straight from OPFS, which workers can open, so no large buffer
crosses the message boundary.

## Messages to the worker

| Message | Meaning |
|---|---|
| `{type: 'open', revision, threads}` | Create the session from `speech/<revision>/`. Answers `opened` or `failed`. |
| `{type: 'transcribe', job, media, duration, from, plan}` | Decode `media/pending/<job>/<media>`, then run windows `from…plan.length-1` of `plan` (from `windowPlan`). Answers one `window` per window, then `finished`. |
| `{type: 'stop'}` | Finish the current window, then answer `stopped`. Used when another job goes first; the job resumes later from its saved `windowsDone`. |
| `{type: 'time', seconds, repeat}` | Calibration: decode a generated signal of `seconds`, `repeat` times, and answer `timed {ms}` with the last run's time. |

## Messages from the worker

| Message | Meaning |
|---|---|
| `{type: 'opened', ms}` | The session is ready; `ms` is how long creating it took. |
| `{type: 'window', job, index, tokens: [[text, time]], ms}` | The kept tokens of window `index`, times absolute in seconds. |
| `{type: 'finished', job}` | All windows are done. |
| `{type: 'stopped', job, next}` | Stopped before window `next`. |
| `{type: 'timed', ms}` | Answer to `time`. |
| `{type: 'failed', job?, reason}` | For example: no audio track mp4box can read, or the decoder refused the codec. The job is marked failed, with the reason shown. |

## Guarantees

- Windows are answered in order. Each window's tokens lie in its keep range, so concatenating the
  answers gives the transcript (data-model invariant).
- Audio is decoded and resampled only as far as the next window needs, so memory is bounded by
  about one window's decoded audio plus the model, not by the video's length.
