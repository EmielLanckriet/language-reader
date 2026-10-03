# ADR-0036: Subtitle tracks are kept and chosen at import
Status: Accepted. Date: 2026-10-03. Spec: [012](../../specs/012-subtitle-track-choice/spec.md).

Termux downloads every human subtitle track in any language (`--write-subs --sub-langs all`) and
automatic Chinese only when no human Chinese arrived; it never requests YouTube's machine-translated
variants, which caused HTTP 429. Tracks are named `track.<lang>.vtt` / `track-auto.<lang>.vtt` and
described by `tracks.json` (language, YouTube name, human or automatic), so a human English track
can never be taken for Reader's own machine English (`media.en.vtt`). Names are not trusted for
content: a track is mixed when most cues carry a separate line without Chinese (Jun's pinyin track
is called "Chinese (Simplified)").

Reader asks only when there is a real choice: two different clean human Chinese tracks, or a human
English track. One rule decides this in the app and in translate.py, tested against one shared case
table, because Termux must know whether to translate at once or wait. When a choice is asked,
Reader reports it (`PUT /downloads/<job>/choice.json`) and Termux translates only then, and only
when machine English was chosen. Human English is matched to Chinese lines by greatest time overlap
and shown alone: a line its maker left untranslated stays so, because the reader trusts that
judgement (decided in the phone check, 2026-10-03). Flashcards still fall back to machine English.

The Chinese text is fixed at import; choosing another Chinese track means importing the kept
download again as a new document. The English choice (`english.json`) is derived and can be switched
later without touching earned data. Every downloaded track is kept beside the document.

Deployment order: the app before the Termux scripts. A newer Termux beside an older app would wait
for a choice that is never sent.

Accepted limitation: backups keep the Chinese track and meta.json only. After a restore a document
shows machine English, as before 012, until its download is imported again.

Rejected: one yt-dlp pass with automatic captions for all languages (rate limited); adding `en` to
the automatic list (falls back to machine-translated English); translating before the choice and
redoing it (wasted phone work during open thermal validation); matching English by cue index.
