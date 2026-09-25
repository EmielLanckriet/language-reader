# ADR-0017: Termux Is The Import Pipeline For Media, And Nothing At Read Time

**Status**: Accepted
**Date**: 2026-09-25
**Relates to**: ADR-0007 (no server, browser first), the change register's "Analysis Is Import-Time"
and "Prefer Local Computation", constitution Technology Stack (preserved options)

## Context

The reader wants video and audio first, from YouTube, and called picking an `.srt` by hand "a major
hurdle". A browser cannot download from YouTube: no CORS, and YouTube actively defeats downloaders.
Something outside the browser has to run `yt-dlp`, and ADR-0007 says there is no server.

Measured on 2026-09-25 against three Chinese vlogs: two had human Chinese subtitles, one had none
(burned in). Asking for YouTube's machine-translated tracks as well got HTTP 429 and cost the video.

## Decision

**Termux on the phone runs the downloader, at import time only.** Sharing a URL to Termux runs
`scripts/termux/termux-url-opener`: yt-dlp fetches a 480p mp4 and the original-language Chinese
subtitle tracks, and the files travel to the app as **one uncompressed tar** (Termux shares one
file). The app receives it through its manifest `share_target`, or through a file picker, and reads
the tar by slicing — a video is never copied into memory.

The app never talks to Termux while reading. Anything Termux later adds (speech-to-text, translated
lines) arrives as more files in the same tar.

## Alternatives Rejected

- **The laptop runs yt-dlp.** Works, but the deployed app is HTTPS and cannot fetch from the laptop
  over plain LAN, so the file has to be moved by hand — the same hurdle as picking an `.srt`.
- **A cloud proxy running yt-dlp.** Most convenient; breaks ADR-0007, and YouTube often blocks
  datacenter addresses, so it would be unreliable as well as a server.
- **Termux as a localhost server the app calls while reading.** More flexible (on-demand lookup,
  Anki export), but Android kills background processes, Chrome asks for local-network permission,
  and every feature would need a "Termux is not running" path. Kept available for the few things
  that may need it, Anki export being the likely one.

## Consequences

- **Easier:** Python-only tools rejected under ADR-0007 are usable again at import — Whisper
  (`whisper.cpp`), genanki, possibly pkuseg. They produce files; the app stays self-contained.
- **Harder:** the app now depends on a second app for its main content source, and on yt-dlp
  keeping up with YouTube. The script tells the reader to run `yt-dlp -U` when nothing downloads.
- **Cost measured in the emulator:** Termux with python, ffmpeg and nodejs is 724 MB, down from
  1.2 GB by skipping recommended packages (which pulled in clang). See docs/backlog.md.
- **Revisit if** Termux becomes unmaintained, or Android stops letting it hand files to other apps.
