# ADR-0019: A Transcript Streams From Termux While The Video Is Watched

**Status**: Accepted
**Date**: 2026-09-25
**Relates to**: ADR-0017 (amends "nothing at read time"), ADR-0018, the change register's
speech-to-text row

## Context

One vlog in three measured had no Chinese subtitles, so speech-to-text is needed. Whisper `small`
measured 1.5% character errors against human subtitles (on a clear learner video, which flatters
it) and `base` 6.4%. But a whole 7-minute video took 123 s with `small` on the laptop, and a phone
is slower. The reader ruled that out: waiting minutes before anything is readable was the friction
that made Sapling hard to use. The first 20 s must be readable within 10–20 s.

Transcribing in chunks is easy. The hard part is getting partial results to the app, which so far
received one finished tar through the share sheet.

## Decision

**Termux shares the video at once and serves the transcript as it grows.** When yt-dlp finds no
Chinese subtitles, the tar carries `transcribing.json` instead. `scripts/termux/transcribe.py` then
transcribes in 30 s chunks: `base` for the first, so lines arrive fast, and `small` after that. It
rewrites `media.zh.vtt` and `status.json` after each chunk, served on `127.0.0.1:8765` with CORS
and private-network headers.

The app keeps the video in OPFS `media/pending/<job>/` and opens a live page. That page polls every
2 s, segments new lines with the fast analyzer, and allows lookup but not marking. **Nothing reaches
the database until the transcript is done.** Then it becomes an ordinary media document through the
same path as a subtitled video (ADR-0018), and the page moves to it at the same point in playback.

ADR-0017's "nothing at read time" becomes: **Termux is needed only while an import is finishing.**

## Alternatives Rejected

- **Whisper in the browser.** Progressive by nature and needs no Termux, but a 488 MB model in a
  phone browser is the Sapling experience this exists to avoid.
- **One share at the end.** The simplest, and it is the wait the reader ruled out.
- **A share per chunk.** Every share is a share-sheet tap.
- **Writing the document early and growing it.** It would change a stored document's
  `raw_content` and tokens after creation. That touches the irreversible surface, and nothing needed it.
- **`--audio-ctx` to shorten the first chunk.** Measured no faster, and it hallucinated repeats.

## Consequences

- **Measured** (laptop unless noted): the first lines arrive 9 s after the video is ready. `small`
  keeps about 2× ahead of playback. The emulator's Termux runs about 2.2× faster than playback with
  the AVX2 build. Two findings changed the code: **4 threads, not all cores** (16 threads beside
  other load took 44 s against 6 s), and **no baseline builds** (without AVX2 or ARM dotprod, 4.4×
  slower). `scripts/termux/build-binaries.sh` builds the variants; setup picks one by
  `/proc/cpuinfo`.
- **Not measured: any of this on the reader's phone.** The first-chunk time there decides whether
  the design meets its target. If `small` cannot keep ahead of playback, the reader catches up with
  the transcript and waits.
- **Harder:** Termux must stay open until the transcript is done (it takes a wake lock), and Chrome
  may ask once for local-network permission. The emulator's Chrome 124 predates that prompt, so it
  is untested.
- **Harder:** marking waits for the end of the transcript, because a word needs a stored lexeme.
- **Revisit if** the phone cannot keep ahead with `small` (use `base` throughout), or if an
  on-device Whisper in the browser becomes fast enough to drop the Termux link.

## Amendment, 2026-09-26: lines cut at punctuation

Measured on the phone with a 2½-minute cooking video: the first "line" was the whole first chunk,
149 characters over 30 s, and 17 lines in all, some of 60–100 characters. The prompt that keeps
`base` in simplified characters (`以下是普通话的句子。`) is the cause: with any prompt, whisper.cpp
returns a chunk as one punctuated segment (11 segments without it, same audio), and its `--max-len`
does nothing then. `transcribe.py` now reads whisper's full JSON (`-ojf`) and cuts each segment at
clause punctuation, each line starting at its first token's time, or after 24 characters for speech
whisper did not punctuate: 46 lines of 2–21 characters for the same video, times continuous across
chunks. Measured on that video, 17 s from the share to a playable video in Reader, first line at
39 s, quick English on it at 59 s (ADR-0023).

Also found: `translate.py` started a moment before `transcribe.py` wrote its status, saw no Chinese
at all, and finished with nothing, so no transcribed video had been translated by the LLM. It now
waits while `transcribing.json` says a transcript is coming.

With that fixed, the LLM ran beside the transcriber, and the two shared the phone's four cores: the
same video's transcript took 6:50 from the share against 4:20 before. It now waits until the
transcript is complete (Reader's quick English covers the lines meanwhile, ADR-0023). Measured on
the phone with that change, from the share: the video playable in Reader at 20 s, the first 11 lines
at 34 s, quick English on the first at 34.4 s, the transcript a stored document at 4:26, and the
LLM's first 20 lines 90 s after that. Free memory never below 1.77 GB.

Later the same day, a street interview (several speakers, pauses) showed the prompt did worse than
lengthen lines: with any prompt, whisper.cpp returns a chunk as its first sentence only, and the
rest of the chunk is lost. 11–38 s of the interview, 13 lines, came back as one line; without a
prompt, 16. The prompt is gone. It had kept `base` in simplified characters, but on both videos
measured, `base` and `small` without it wrote none (checked with OpenCC's t2s, which changed
nothing), and Reader's dictionary has the traditional forms too. Revisit if traditional characters
appear. The whole interview now gives 122 lines, none over 21 characters, no gap over 5 s.
