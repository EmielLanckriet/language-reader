# ADR-0050: A video's lines are edited as a layout over its fixed text

Status: Accepted. Date: 2026-11-07. Replaces the joined runs of `sentences.json`.

YouTube's subtitles are sometimes cut badly: a human English track split mid-sentence across lines
(非诚勿扰), English one line off, Chinese lines that drift out of sync with the sound. The reader
asked to fix these by hand, rarely: a long press on a line opens it; merge, split at a cursor, and
shift backward or forward, for the Chinese and the English at once.

A media document's text is the Chinese lines joined by line breaks, and everything earned points
into it by offset: encounters, lookups, corrections (ADR-0049). Changing it means a new document
in the old one's place (as switching the Chinese track does), which drops that document's
corrections.

Decided:

- **The text never changes.** Edits are a layout over it (`media/layout.ts`, kept in
  `layout.json` beside the video): where shown lines start (an original line start left out, or a
  cut inside a line), a timing shift for every line and per shown line, and English placed by
  hand. Retyping a wrong character is not offered.
- **A cut inside a line is timed by its characters**, in proportion; a split snaps to the
  analyzer's word boundaries. The recorder counts in the document's own lines with the shifts
  applied.
- **English placed by hand is its own choice**, "Edited by you", next to the video's tracks and
  machine English; the first English edit starts it from the English shown then. It is kept as
  spans of shown lines by text position, so it stays put when the Chinese is cut differently
  later. No translator runs while it is chosen.
- `sentences.json` is read once as joins. Copies carry `layout.json` (and `sentences.json`).

Not done: card audio still uses the lines' original times.
