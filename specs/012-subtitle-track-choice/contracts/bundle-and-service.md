# Contract: bundle contents and reader-service additions (spec 012)

Extends `specs/008-in-app-speech-to-text/contracts/reader-service.md`. Version stays compatible:
a pre-012 app ignores the new files; a pre-012 bundle is imported as before.

## Bundle (`bundle.tar`) from 012 on
- `media.mp4`, `media.jpg`, `meta.json` — unchanged.
- `track.<lang>.vtt` for every human track; `track-auto.<lang>.vtt` for automatic Chinese tracks,
  present only when no human Chinese track exists.
- `tracks.json` — the manifest (data-model.md).
- No `media.<lang>.vtt` subtitle members in new bundles. Pre-012 bundles keep them and no manifest.

## Job folder on Termux
Same as the bundle, plus Termux's own files: `media.en.vtt` and `translate.json` (machine English,
unchanged format and meaning), `choice.json` once Reader reported a choice.

## `PUT /downloads/<job>/choice.json`
Body: `{ "chinese": string, "english": string }` as in data-model.md.
- 204: stored; translate.py started for `english: machine` unless already running; not started for
  a human English track or `none`.
- 400: not JSON, unknown fields' values, or a named `file` not in the job's `tracks.json`.
- 404: no such job.
With `chinese: transcribe` nothing starts now; translation follows the transcript's
`PUT /downloads/<job>/media.zh.vtt` as today, limited by the stored `english` choice.
Idempotent: a repeated identical choice changes nothing; switching `english` to `machine` (US4)
starts translation of every line.

## translate.py
- Source track: `choice.json`'s `chinese` when present; else, for a 012 job with no choice needed,
  the default Chinese track; else (pre-012 job) today's rule.
- With a human English track in `choice.json`, translates nothing (`translate.json.total` is 0):
  lines the track leaves untranslated stay so.
- Never starts for a job whose choice is needed and not yet reported.
- The "choice needed" rule is checked against `tests/fixtures/track-choice-cases.json`, the same
  table the app's tests use.
