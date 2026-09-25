# ADR-0023: Fast First, Better In The Background

**Status**: Accepted
**Date**: 2026-09-26
**Relates to**: constitution 1.5.0 (adds Principle VIII), ADR-0003 (derived data), ADR-0019
(staggered transcription), ADR-0021 (line translation, amended here)

## Context

Qwen3-1.7B (ADR-0021) was measured on the phone for the first time. After capping its context
(without `-c` llama.cpp reserved the model's 40k-token context, 6.4 GB peak, and froze the 5.6 GB
phone twice), it runs: 2.45 GB peak, never below 1.04 GB free. But 20 lines of 小Lin说's tariff
video took 77 s, and those lines are 22 s of video: the whole 10½-minute video (518 lines) would take
about 28 minutes. The reader would run out of English about 40 s into watching.

The same 20 lines, on the laptop:

| Model | On disk | Peak memory | 20 lines | English |
|---|---|---|---|---|
| Qwen3-1.7B Q8 | 1.8 GB | 2.1 GB | 14 s | Best; moves a little meaning between neighbouring lines |
| Qwen3-0.6B Q8 | 0.64 GB | 0.94 GB | 7 s | Lines 17–19 shifted by one, which the count check does not catch; 白 read as "white" |
| opus-mt-zh-en q8 | 109 MB | 0.58 GB (with Node) | 4 s | Aligned by construction; weak on fragments: 不是判特朗普的 → "Not Trump.", 那他去年轰轰烈烈 → "a big guy last year" |
| Mozilla `base/zhen` | ~60 MB | — | — | Not run: its engine (Bergamot) must be built from source |

Giving opus-mt several lines at once, with newline, ` / `, ` | `, `。` or numbered separators, gave
more fluent English but split back into the right number of lines in 1 of 20 groups, and dropped
whole lines silently. It is a line-at-a-time model here.

The reader's answer was not to choose: "try opus-mt first and then update with Qwen in background,
this should be the general design principle for everything, fast to make it hassle-free and
incremental background operation to improve while using it already."

## Decision

1. **Constitution Principle VIII** (MINOR, 1.4.0 → 1.5.0): every derived result reaches the reader
   within seconds, even if rough; a better one may replace it piece by piece in the background; a
   better piece is never overwritten by a rougher one; each piece records the method that made it.
   Derived data only.
2. **Line translation is layered**: opus-mt translates each line at once, and Qwen3-1.7B's lines
   replace them as they arrive from Termux. Each line records its source (`opus` or `qwen`). Where
   opus-mt runs, in Reader through its ONNX runtime or in Termux, is decided when it is built and
   recorded here.

## Alternatives Rejected

- **Qwen alone, translated ahead**: the best English, but the reader waits half an hour or reads
  without English. That is the friction Principle VIII exists to remove.
- **opus-mt alone**: fast and small, but its English on subtitle fragments is too often wrong to be
  the final answer.
- **Qwen3-0.6B**: fast enough, but it shifted lines while passing the count check. A translation
  beside the wrong line is worse than none.
- **Joined lines for opus-mt**: better English, but unalignable and lossy.

## Consequences

- **Easier**: English appears within seconds of opening a video, and improves while it is watched.
  The same shape covers future upgrades (a better model is one more layer behind the others).
- **Harder**: two translators to ship, and the app must merge line sources without letting a
  rougher one win.
- **Open**: the count check in `translate.py` does not catch shifted lines; Qwen's lines need a
  stronger check before they replace opus-mt's.
