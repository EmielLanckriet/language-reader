# Contract: the reader service's transcript upload

The one change to `scripts/termux/reader-service.py`'s interface (ADR-0020, ADR-0022). The CORS
and private-network headers it already sends on every reply cover this too.

## `PUT /downloads/<job>/media.zh.vtt`

- **Body**: the finished transcript as WebVTT, `Content-Type: text/vtt`.
- **Effect**: writes `~/downloads/<job>/media.zh.vtt` aside and renames it into place, then starts
  `translate.py ~/downloads/<job>` in the background, unless `translate.lock` shows it already
  running for that job.
- **Answers**:
  - `204` when stored (translation started or already running);
  - `404` when there is no such job folder;
  - `400` when the body doesn't parse as WebVTT with at least one cue.
- **Idempotent**: sending the same transcript again changes nothing, and translation isn't started
  twice.

Reader writes `transcript-sent` beside the document's media after a `204`. On a `404` the job is
gone from Termux (pruned or never there), so Reader writes `transcript-sent` with
`{"gone": true}` and stops retrying: the lines keep Reader's quick English. Any other failure
(the service unreachable, a `5xx`) is retried.

## `GET /downloads`

The `transcribing` field is removed from each job. Nothing else changes.

## `translate.py`

When `media.zh.vtt` is present and `transcribing.json` is absent, the source counts as complete
(`source()`), exactly as for a downloaded Chinese track. From there it translates to `media.en.vtt`
and `translate.json` as today, and Reader's `followTranslation` picks them up.

## `PUT /busy` (added after the phone check, 2026-09-29)

- **Body**: none. **Answer**: `204`.
- **Effect**: touches `~/.reader/busy`. `translate.py` waits before each 20-line chunk while that
  file is younger than 90 s, whichever job it translates (a downloaded track or Reader's
  transcript).
- Reader sends it every 20 s while it loads, transcribes or calibrates. Measured on the phone,
  translation beside transcription took a 30 s window from 22 s to 55 s: the LLM's 4 threads and
  the decoder's 2 shared the phone's 2 fast cores. 90 s, not 45: Chrome runs a hidden page's timers
  about once a minute, and transcription carries on while the page is hidden.

## Later changes

Spec 012 adds `tracks.json` and `track*.vtt` to bundles, `PUT /downloads/<job>/choice.json`, and
translate.py's choice of source track: [contract](../../012-subtitle-track-choice/contracts/bundle-and-service.md).
