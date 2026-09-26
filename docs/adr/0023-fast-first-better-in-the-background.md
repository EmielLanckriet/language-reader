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
   replace them as they arrive from Termux. Each line records its source (`quick` or `llm`,
   `src/lib/translation/lines.ts`), and the two are kept in separate files beside the video
   (`quick-english.json`, `media.en.vtt`), so neither can overwrite the other.
3. **opus-mt runs inside Reader**, in a worker, on the ONNX runtime 1.29 the segmenter already
   ships and caches (`/ort/`), with our own Unigram tokenizer and greedy decoder
   (`src/lib/translation/`, ~150 lines). Its tokenizer gives ids identical to transformers.js on
   the 20 test lines, and 19 of 20 translations are identical (the twentieth differs on a
   near-tie, presumably numerical, between runtime versions). 20 lines take 4.9 s single-threaded on
   the laptop. The model (~115 MB, quantized encoder and merged decoder, from HuggingFace) is
   downloaded the first time a video is opened, into the model cache beside the runtime, so it
   works offline and survives deploys. Lines are translated nearest-first from where playback is,
   and a line the reader taps jumps the queue.

   Rejected for this: **in Termux**, because Termux has the ONNX runtime only as a C library (no
   Python binding, and onnxruntime-node does not run on Termux), and it would only help imported
   videos, not pasted text; **transformers.js**, because it brings a second runtime (1.31-dev),
   loaded from a CDN unless copied and cached like `/ort/`, for code we can own in 150 lines.

4. **The LLM behind it is Qwen3-1.7B at Q4_K_M, run with `--no-repack`** (was Q8, ADR-0021).
   Measured after the quick English existed, which changed the question from "the best English" to
   "the best English that can run beside Reader":

   | On the phone, 20 lines | Q8 | Q4_K_M, `--no-repack` |
   |---|---|---|
   | llama-completion peak | 2.45 GB | 1.38 GB |
   | Lowest free memory, Reader's quick translator loaded | 1.04 GB (Reader closed) | 1.43 GB |
   | Time (the lines are 22 s of video) | 77 s | ~65 s |

   **Repacking** is why Q4 first looked no smaller: llama.cpp keeps a rearranged copy of Q4 weights
   for speed, 2.0 GB peak on the laptop against 1.4 GB without, and the phone was no slower
   without it. Q4 at 20 lines kept 20/20 lines aligned on the tariff lines, with English close to
   Q8's; on the phone one line (12) repeated its neighbour's content under a matching count. At
   5 lines per prompt it shifted lines 16–19, so the chunk stays at 20.

   `translate.py` waits before each chunk until 2.0 GB is free (the 1.1 GB model, which must stay
   resident, 0.55 GB of buffers, and a margin, because Android counts the model's own file pages as
   available), and Reader unloads its quick translator once every line has English, which frees
   about 0.6 GB. So the upgrade starts when the quick pass is done or Reader is closed, and the two
   do not compete for the memory that froze the phone.

## Alternatives Rejected

- **Qwen alone, translated ahead**: the best English, but the reader waits half an hour or reads
  without English. That is the friction Principle VIII exists to remove.
- **opus-mt alone**: fast and small, but its English on subtitle fragments is too often wrong to be
  the final answer.
- **Qwen3-1.7B at Q8, and Q4 with repacking**: both about 2 GB or more, which with Reader open
  leaves the phone too little; the Q8 froze it twice.
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
- **Open**: a transcript still being written (the live page, ADR-0019) gets only the LLM's lines
  so far; quick English for growing lines is the next step.
- **Open**: the model's own settings ask for a 6-way beam search; greedy decoding is what was
  measured and shipped, as the fast first. Beams would cost about 6× per line.
- The diagnostics page's "discard" frees the whole model cache, so it frees this model too.
