# ADR-0018: Media Originals Live Beside The Database, And Line i Is Cue i

**Status**: Accepted
**Date**: 2026-09-25
**Relates to**: ADR-0003 (earned versus derived, preserve the inputs), ADR-0008 (SQLite in OPFS),
ADR-0017, the change register's "Subtitle import" row (which proposed timing columns)

## Context

An imported video has a media file (tens of MB), one or more subtitle files, and metadata. The
register expected subtitle import to add timing metadata as columns. That means a migration — the
irreversible surface — for a first version whose shape was still a guess.

## Decision

**A media document is an ordinary document whose text is its subtitle cues, one per line.** Cue text
is joined with spaces so it never contains a newline; line i of `raw_content` is cue i.

**The files it came from are kept verbatim in OPFS under `media/<documentId>/`**, outside the
SQLite pool (`.opfs-sahpool`). No table records them: a document has media exactly when that
directory exists. Cue timings are re-parsed from the stored `.vtt` when the document opens.

## Alternatives Rejected

- **Timing columns or a cues table.** A migration before the design had met a real video. The
  retained `.vtt` holds everything a later table would, so adding one then loses nothing.
- **Media as SQLite blobs.** Every playback would copy tens of MB through the storage worker;
  OPFS files are handed to `<video>` directly.
- **Keeping only the parsed cues.** Forfeits re-parsing with a better parser, the same trap as
  discarding source text (ADR-0003).

## Consequences

- **Easier:** no migration; a new source (speech-to-text) only has to produce a `.vtt`.
- **Harder — and this is the one to remember:** earned-data backup (docs/backlog.md, the store-wipe
  item) must copy `media/` as well as the database, or restored documents lose their video.
  Deleting a document must delete its directory; nothing does yet.
- **Harder:** `raw_content` of a media document is derived from the `.vtt` rather than being the
  input itself. The input is kept, so this is recoverable, but it is not the paste case.
- **Revisit if** anything needs to query cues (search by time, per-line progress), which is when a
  table earns its migration.
