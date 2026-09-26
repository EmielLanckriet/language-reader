# ADR-0021: Each Line Is Translated By A Small Local Model In Termux

**Status**: Accepted; amended by ADR-0023 (opus-mt first, this model behind it, now at Q4_K_M with `--no-repack`)
**Date**: 2026-09-25
**Relates to**: ADR-0017, ADR-0019 (the same import-time streaming), the register's "Analysis Is
Import-Time" and "Local LLM rather than an API"

## Context

The usable product translated a sentence by opening Google Translate: it needs a network, and the
English leaves the app. The reader asked for good local translation, into English. Termux can run a
language model at import time, so the question was which model is good enough and fast enough.

Measured on the first 20 lines of the HSK vlog (context-dependent lines such as 退瓶子 and 押金):

| Model | Size | Laptop, 4 threads | Emulator Termux | Lines kept aligned |
|---|---|---|---|---|
| Qwen3-1.7B Q8 | 1.8 GB | 12 tok/s | 27–30 s per 20 lines | 20/20; three small slips |
| Qwen3-1.7B Q4 | 1.1 GB | 22 tok/s | — | **19/20**: merged two lines, invented a word |
| Qwen3-4B-Instruct Q4 | 2.5 GB | 8–9 tok/s | — | 20/20; best English, 2–3× slower |

## Decision

**Qwen3-1.7B at Q8, through `llama-completion`, translating 20 lines per prompt** in
`scripts/termux/translate.py`. It writes `media.en.vtt` with the Chinese track's timings, and the
reader service serves it as it grows. While a transcript is still being written, it starts after
8 lines. A chunk that does not come back with exactly one line per input is redone a line at a time.
The app shows English hidden, per line, revealed on tap (the reader's choice), and keeps it with the
document once complete.

## Alternatives Rejected

- **Q4 of the same model**: 40% smaller and twice as fast, but it merged lines. A translation beside
  the wrong line is worse than none.
- **The 4B model**: the best English, but 2.5 GB, slower, and on a machine short of memory it
  re-reads the whole file from disk each run.
- **Keeping Google Translate**: rejected for the English; the link stays for pasted text, which has
  no Termux import.
- **Translating in the browser**: the same 1–2 GB download, in a phone browser.

## Consequences

- **Easier**: translation is offline, part of the import, and derived. A better model later is a
  re-run over the kept Chinese track.
- **Harder**: 1.8 GB more on the phone (about 3.2 GB for Termux and its models), and translation
  shares the CPU with transcription when both run.
- **Not measured on the phone.** The emulator's 30 s per 20 lines covers about 90 s of video; the
  arm64 build has to be checked on the device.
- **Revisit if** the phone falls behind playback (a smaller chunk, or the Q4 with an alignment
  retry), or if contextual word glosses are added: the same model at import can gloss each word in
  its line, which would restore the register's "glosses computed at import".
