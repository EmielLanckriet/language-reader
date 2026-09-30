# ADR-0035: Source-backed flashcard examples and audio
Status: Accepted. Date: 2026-09-30.

Select examples from unwithdrawn encountered ranges, then original Anki examples imported read-only.
Retain imported source text/identity as append-only encounter facts and audio as content-addressed
files recoverable from a source bundle. Do not label library presence or Anki import as a reading event.
Use full subtitle cues when timing is cue-level, and play bounded source intervals without extracting
whole-video audio. Word recordings already in Anki take priority; new device speech is on demand.
Audio appears after reveal to keep current reading recall labels interpretable. Pre-answer listening
needs a separate prompt protocol. No new phone model, paid service or subscription is introduced.
Rejected: fabricated example visits, guessed within-cue timestamps, mutable example rows that erase
source versions, and copying the laptop Kokoro inference stack onto the phone.
