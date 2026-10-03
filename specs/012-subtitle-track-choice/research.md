# Research: Subtitle track choice at import

## R1 — Downloading human tracks in every language without translated variants

Measured 2026-10-03 on the laptop, yt-dlp 2026.08.19, Jun's xEoY1KyrYls, subtitles only:
`--write-subs --sub-langs 'all,-live_chat'` requested exactly the two human tracks (zh, zh-Hans),
one request each. `--write-subs` never touches `automatic_captions`, which is where YouTube's
machine-translated variants live; those caused HTTP 429 when requested before.

- **Decision**: two passes in `termux-url-opener`. Pass 1 (with the video): `--write-subs
  --sub-langs 'all,-live_chat'`. Pass 2, only when pass 1 produced no Chinese track:
  `--skip-download --write-auto-subs --sub-langs '<today's zh list>'`, written under a distinct
  output name so automatic tracks are recognisable. The script then writes `tracks.json` from the
  info JSON (`subtitles[lang][*].name`) before it trims the info JSON to `meta.json`.
- **Rationale**: yt-dlp file names (`media.<lang>.vtt`) carry neither the YouTube track name nor
  human/automatic; both are only in the info JSON, which the script currently deletes.
- **Alternatives**: one pass with `--write-subs --write-auto-subs --sub-langs all` (requests every
  machine-translated variant: the 429 cause); adding `en` to today's list (when no human English
  exists, yt-dlp falls back to the automatic, machine-translated English: neither human nor wanted).
- **Open for implementation**: verify naming on a video that has a human English track, and that
  YouTube serves at most one human track per language code (yt-dlp keys `subtitles` by language).

## R2 — Recognising mixed tracks

- **Decision**: reuse `chooseChineseTrack`/`mixedShare` (`src/lib/media/subtitles.ts`, commit
  f784e37) and its Python twin in `translate.py` (a7a6b86): a cue is mixed when it has a Chinese line
  and a separate line with no Chinese; a track is mixed above 30% of cues. Extend it to report the
  classification so the choice can label tracks, and to recognise English-only tracks (no Chinese
  line in most cues) by the same per-line test.
- **Rationale**: track names say nothing (Jun's pinyin track is "Chinese (Simplified)"); per-cue line
  structure separates brand names inside a line from a whole second line.
- **Alternatives**: share of Latin letters overall (flags clean tracks with brand names; a test
  covers this); YouTube names (unreliable).

## R3 — Matching English cues to Chinese cues

- **Decision**: assign each English cue to the single Chinese cue it overlaps most in time (ties to
  the earlier); a Chinese line's English is the concatenation of the English cues assigned to it,
  in order. A Chinese line with no assigned cue is "uncovered" and gets machine translation.
- **Rationale**: assigning from the English side guarantees FR/US3's "no English line under two
  non-adjacent Chinese lines" by construction, and keeps every English cue shown exactly once.
  Learning channels usually time both tracks identically (Jun's two Chinese tracks share every
  timestamp), which makes this an identity mapping in the common case.
- **Alternatives**: index alignment (breaks when counts differ); text alignment via translation
  similarity (needs a model; disproportionate).
- **Test**: properties, not values (Principle II applies to derived data): every English cue appears
  exactly once; order is preserved; identical timings give a one-to-one mapping.

## R4 — Keeping human English apart from machine English

Today `isTranslation` is any `*.en.vtt` (`src/lib/media/store.ts:171`) and translate.py writes
`media.en.vtt`; a downloaded human English track named by yt-dlp's default template would be taken
for the machine translation, on Termux and in the app.

- **Decision**: downloaded tracks are written as `track.<lang>.vtt` (human) and
  `track-auto.<lang>.vtt` (automatic), described by `tracks.json`. `media.*` names keep their
  current meanings: the chosen Chinese track in a document folder, and Reader's/Termux's own files.
  `isSubtitle` excludes `track*` names. Old bundles (`media.<lang>.vtt`, no `tracks.json`) are read
  as before (FR-009). A document keeps every track it was offered (FR-008) plus the chosen Chinese
  track under its usual `media.<lang>.vtt` name, so nothing that reads `cues` changes.
- **Alternatives**: renaming only English tracks (still leaves human/automatic indistinguishable);
  a subfolder (OPFS document folders are flat today and `loadMedia` lists one level).

## R5 — When the phone translates (FR-011, clarified)

- **Decision**: the rule "a choice will be asked" is one pure function in each language
  (TypeScript in the app, Python in translate.py) fed by the same `tracks.json` and track texts,
  tested against one shared fixture table (`tests/fixtures/track-choice-cases.json`) so the two
  cannot drift silently. termux-url-opener starts translate.py only when no choice will be asked
  and no human English exists, exactly as today. Otherwise translation starts when Reader reports
  the choice with `PUT /downloads/<job>/choice.json`; the service then starts translate.py, which
  translates the chosen Chinese track and only the lines the chosen English does not cover.
- **Rationale**: translation is the phone's heaviest work (ADR-0032, freeze incident). Asking Reader
  for every job would delay the common no-choice case, which the reader did not want (Clarification 2).
- **Alternatives**: always wait for Reader (option C, rejected by the reader); translate the default
  and redo on a different choice (option A, wastes phone work).
- **Deployment order**: app first, then Termux. A Termux script newer than the app would wait for a
  choice an old app never sends; the service also accepts no choice for a job older than the update.

## R6 — Which English a line shows (Principle VIII)

- **Decision**: per line, in order: human (aligned chosen English track, R3), then the local LLM
  (`media.en.vtt`, by start time as today), then the quick model. `englishFor` gains a `human` input
  and an `EnglishSource` of `'human'`. Human lines are never replaced; the reader's English choice
  (`english.json`: `{source: 'track', file} | {source: 'machine'} | {source: 'none'}`) selects which
  inputs are consulted, and changing it rewrites nothing earned.
- **Alternatives**: writing the human English into `media.en.vtt` (loses the origin of each line,
  and translate.py would overwrite it).
