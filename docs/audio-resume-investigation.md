# Audio resume investigation — 2026-09-29

## Finding

On the connected Samsung A71, restarting AAC decoding mid-file changes the samples fed to the
speech model. Decoding from the beginning removes those differences in the measured windows.
This is evidence for decoder-history dependence, not a checkpoint or subtitle-joining error.
The exact codec mechanism and the effect on recognised text were not measured in this run.

## Measurement

Used the retained 230.83-second street-interview MP4 from spec 008. A longer fixture than the usual
90 seconds is necessary here: the reported interruption was at window 5, starting at 120 seconds.
The probe bundles the actual `SpeechAudio`, resampler, and window planner, runs in Chrome on the
phone, and compares float32 samples before loading any speech model. It does not access Reader's
storage or Termux service.

The uninterrupted run supplies the reference. Each trial creates a fresh decoder. The control
changes only `startAt` in the probe to leave decoding at frame zero; production code is untouched.

| Trial | Window | Start | Different samples / total | Maximum absolute difference |
| --- | --- | --- | --- | --- |
| Current mid-file resume | 5 | 120 s | 7,260 / 480,000 | 0.0138851 |
| Current mid-file resume | 6 | 148 s | 9,322 / 480,000 | 0.00501075 |
| Decode from zero, first trial | 5 and 6 | 120 s, 148 s | 0 / 960,000 | 0 |
| Decode from zero, second trial | 5 and 6 | 120 s, 148 s | 0 / 960,000 | 0 |

A preliminary main-thread probe also found differences when starting at windows 1, 3, and 7.
The worker-based control above matches the app's execution environment. Differences continue in
later windows; the existing two-frame warm-up does not establish equivalence on this recording.
See [raw results](../scripts/measure/sensevoice/resume-audio-results.json).

## Next implementation decision

A deterministic resume could decode and discard preceding audio in bounded batches, then resume
recognition at the checkpoint. Simply removing the seek would accumulate all preceding decoded
samples in memory during the first resumed window and is unsuitable for long videos.

Before changing production behavior, measure the startup cost and memory of a bounded replay on a
long recording, and compare actual resumed recognition with uninterrupted recognition. Cached
canonical audio is an alternative with a storage cost. The saved original media remains available;
no learning history needs migration. Production resume behavior has not been changed by this
investigation.
