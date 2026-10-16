# Research: Find videos by due and new words

Measured in the laptop prototype (`scripts/content-prototypes/`, issue #11, 2026-10-16) unless said.

## R1. Score an unsaved text with the library's code

**Decision**: segment the candidate's text with the analyzer in force and `resolveTokens`, count
occurrences by lexeme key, then look the keys up read-only (`wordsByForm`: lexeme id by written
form, plus whether each was met). Keys with no lexeme get placeholder negative ids, which have no
state or memory, so `kindOf` counts them new, as it would a never-seen word. Then `textShares`,
`understood` and a due list (`dueWords`, the predicate `wordCounts` uses, extracted so both share it).

**Rationale**: FR-005 and SC-002 ask for exactly the library's figures. The prototype saved each
candidate as a document to get them; Reader must not (FR-012). Lexeme identity in Chinese is the
written form (`lexeme_language_surface`), so a lookup by form finds the same words a save would.

**Alternatives**: saving and then deleting a document (writes history, leaves hidden documents);
scoring in Termux (no analyzer there, and the dictionary analyzer scored 1.7–10.6 points lower).

## R2. Never met

**Decision**: never met = no lexeme, or a lexeme with no mark, no memory, and not in
`ENCOUNTERED_WORDS` (read, played, lookup, check ranges and Anki examples) nor named by a review.
The same definition the prototype validated: fully watched library videos rescored at 0 never-met.

## R3. Service endpoints, and politeness

**Decision**: `GET /search?q=` runs `yt-dlp --flat-playlist -j "ytsearch15:q"` (a few seconds);
`GET /subtitles?id=` runs the opener's two passes (human tracks of any language, then automatic
Chinese only when no human Chinese came) into a temporary directory and returns the Chinese tracks
with `tracks.json`-shaped metadata; `POST /download` starts `termux-url-opener <url>` as a share
would. One yt-dlp at a time (a lock in the service), `--sleep-requests 1 --sleep-subtitles 1`, and
a 429 reported as `{"state": "rate-limited"}` without retrying.

**Rationale**: the opener's subtitle rules are what the import later sees, so a score matches the
import (spec edge case "several human tracks"). Machine translations are never requested
(`--write-subs` does not fetch them; automatic subs only for named Chinese codes, as the opener).

**Alternatives**: one endpoint doing search and all subtitles (no streaming; one 429 fails all).

## R4. Choosing the track

**Decision**: the app's `classifyTracks` and `defaultChoice` on the returned tracks, then
`parseSubtitles` on the chosen one, so the text is what import would make.

## R5. Already in the library, or downloading

**Decision**: `videoDocument(youtubeId)` for the library; the service's `/downloads` list (by id)
for jobs in progress or ready.

## R6. Where settings live

**Decision**: the bar and the last five queries in `localStorage`: per-device conveniences, never
needed elsewhere, safe to lose.

## R7. Rough first, the model after (measured on the phone, 2026-10-16)

**Decision**: score each candidate with the dictionary the moment its subtitles arrive, shown with
"≈"; once every fetch is done, re-score with the library's model, best placed first, replacing the
rough figures.

**Rationale**: on the phone a 20-minute candidate took about 2 minutes: its subtitles 16 s, the
rest the model. A CPU profile of the page over 60 s of scoring was 59.95 s in `ort-runtime.wasm`.
Scored by the model directly, the first result came after 155 s and fifteen would take about half
an hour (SC-001 asks for 60 s and 8 minutes). The dictionary reads 1.7–10.6 points lower
(prototype), so its figures are marked rough until the model's replace them (Principle VIII).

**Alternatives**: the dictionary only (figures disagree with the library's); the model in a worker
(no faster, only kinder to the page; a larger change, left for later).
