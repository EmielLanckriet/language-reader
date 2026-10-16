# Current state

Updated 2026-10-17. Start here for project status; consult the relevant spec and ADR for detail.
This describes repository behavior and recorded results, not a fresh certification of every feature.

## Hardcore no longer drills set-aside words known in Anki (#42) — deployed

On the Vietnam video (document 40, 2026-10-16) a drill offered 味道, 水果, 冷, 舒服 and six more:
Anki words with stabilities of 440–1,311 days, set aside on 2026-10-07 as outside the 2,000 most
common (ADR-0040 amendment). FR-004 made every set-aside word drillable, and `classify` never looked
at its memory. Now a set-aside word is classed like an active card — due by its memory, Anki history
included, or excluded (the reader: Anki words are not special, only a longer imported history).
The other four words of that drill (越南, 酒店, 度, 中国人) were never in Anki: new, correctly.
Found on the phone's backup copy (20:58), not by reading code. Test red first with the phone's
result; 657 tests, type check, lint.

## Spoken stories (spec 018) — deployed and phone checked

A shown story's **Listen to it** sends its sentences to the Termux service (`POST /speak`):
`speak.py` speaks them with **MeloTTS** (the reader's choice by ear among four measured voices,
`scripts/measure/tts/compare.py`) through a static sherpa-onnx build with a small C program that
loads the model once and prints each sentence's times (`scripts/termux/tts/`, release
`tools-tts-1.13.8`), under the translation model's lock and after Reader's transcription; ffmpeg
build 2 (release `tools-ffmpeg-8.1.3-2`) encodes AAC; the times become `media.zh.vtt`; the bundle
appears like a download, which the page imports and opens, so the story plays like a video, one
cue per sentence, with English from translate.py. `setup.sh` installs the speaker and voice (~200 MB).

Phone (build `1792161587859`, Termux scripts at `4b30aa3`, laptop writer over USB): a 315-character
story written on the laptop in ~2 min, then spoken on the phone in 80 s (15 sentences), imported
and opened as document 41 (460 KB of AAC; not played, so no session). Earlier on the phone: 59 s to
speak a 41 s story, 375 MB peak; SenseVoice mishears 6 % of its characters. Lesson for scripts:
ffmpeg reads keyboard commands from stdin, so `-nostdin`; it ate two piped install scripts.

## Following without the picture, and tap reasons (#29, ADR-0043) — deployed

After "Only listened", the session questions ask "Could you follow it without the picture?" (kept as
`followable` in the engagement record); the word sheet offers why a word was tapped (`reason` on the
lookup: unknown, sense, split, misheard, subtitles). Optional, validated, read by nothing yet; for
issue #29's analysis. Tests red first; browser `listened` and `leavingvideo` pass (answers now
scoped to their questions, since "Partly" is offered twice). Browser `sheet` fails on the code
before this too (a missing element to scroll to).

## Stories with your due words (#10, spec 016) — deployed and phone checked

Texts → **A story**: Reader picks up to 10 due words and 300 known ones (its own `isDueWord` and
`kindOf`, most frequent in the library first), asks for an everyday story free to leave out due
words that don't fit, scores each draft as Find videos does, and asks for a rewrite naming the
never-met words (at most twice), keeping the best. The story is shown with its figures; **Read it**
saves an ordinary text ("Story · <date>"), Discard keeps nothing. Drafts go through the Termux
service's `/generate` job: the laptop's writer (`scripts/story-writer/`, Qwen3-4B, port 8766 over
`adb reverse`, or a Wi-Fi address in `~/.reader/laptop.json`) when it answers within 3 s, else the
phone's Qwen3-1.7B through `story.py` under translate.py's model budget, thinking off (on, it spent
its answer reasoning in English). Laptop measurements (research R1): 4B 86–94 % known, 1.7B 82–92 %.

Validation: draft loop and word choice tests, three service tests (stub, fake laptop), browser
`story`; the real story.py on the laptop with the 1.7B (11 s, two threads) and the real laptop
writer through the service (11 s, "laptop"). Phone (build `1792154879372`, Termux scripts at
`3cd96e6`, no laptop): a story in 485 s, three drafts (144 s, then ~2.5 min each), 88.5 % known, 9
never met, **no due words** (the 1.7B left them all out, as the prompt allows). The first attempt
waited for ever: translate.py's budget needs 2 GB free and the phone had 1.93 GB; story.py now says
what it waits for, gives up after 3 minutes with the reason, and Stop or leaving cancels the job.

## Find videos (#11, spec 015) — deployed and phone checked

The library's Videos heading links to **Find videos**: a YouTube search through the Termux service
(new `GET /search`, `GET /subtitles`, `POST /download`; one yt-dlp at a time, 429 reported as
rate-limited), each result's Chinese subtitles chosen as import chooses them and scored as the
library scores a document **without saving it** (`content/find.ts`, `wordsByForm` read-only):
known share, the due words themselves, never-met words. Results are grouped by a known-share bar
(90 % by default, 70–99, remembered): at or above it by due words then fewest never met, below it
folded, no Chinese apart. Download hands the address to `termux-url-opener` as a share does.
Figures come first from the dictionary (≈), then the library's model re-scores them, best placed
first (research R7: the model took ~100 s a candidate on the phone, 59.95 of 60 profiled seconds).

Validation: scoring property test (unsaved = saved, history untouched), six service tests with a
stub yt-dlp, browser `findvideos` (stubbed). Phone (build `1792142815376`, daily Reader, service
script updated by commit hash and restarted through Reader Start): "Chinese comprehensible input
intermediate" — 15 results, the first figures after 18 s, all fetched after 183 s (subtitles ~16 s
each), the first refined after 311 s (≈ 89 → 93.4 % known). Nothing downloaded on the phone.

## Night of 2026-10-16: eight issues worked unattended — deployed

Details and measurements are in each issue; one line each here.

- **Pinyin heteronyms (#15, closed):** a phrase table in front of pinyin-pro
  (`analyzer/pinyin-phrases.ts`). Everyday sentences 22 → 29 of 30, a new both-readings set
  92 → 118 of 129, CPP 9,282 → 9,283 of 10,254 with none broken. 说服 stays shuō.
- **Storage handover (#19, open):** sqlite-wasm caches a failed pool install, so the lease's
  retries could never succeed. With `forceReinitIfPreviouslyFailed` a retry succeeds ~175 ms
  later in Chrome. A failed install's cleanup (`removeVfs`) **deletes the database directory**
  (reproduced when nothing held the files at that moment), so the storage worker now refuses to
  remove the pool's directories (`storage/pool-guard.ts`). That cleanup is a candidate for #25's
  wipe, not a confirmed cause. On the phone the 4 s wait did not reproduce on the old build; one
  load of 16 took 5.4 s on the new one, cause unknown.
- **What a card gave before its grade (#37, closed, ADR-0042):** reviews record `sentenceShown`
  and `heard` (which recordings were played, front or back). Earned data, not used by memory,
  exported for the fit.
- **Attention answer and history twice as fast (#1, open):** the exposure query is bounded by each
  document's longest read/played range instead of 1,000 code points (same rows for all 5,720
  words), and drill sightings are found once a run. Laptop, the reader's backup: a median answer
  1.37 → 0.66 s. Phone: Learning data's fresh report 16–18 s → 10 s.
- **Termux size (#24, closed):** an 8 MB ffmpeg build (`scripts/termux/build-ffmpeg.sh`, release
  `tools-ffmpeg-8.1.3`) replaced Termux's package and its 81 dependencies. Termux's packages went
  628 → 251 MB, with byte-identical merges and thumbnails. `setup.sh` installs it.
- **Exact transcript resume (#14, open for the second pass):** a decoder per window, started 8
  frames early (`speech/audio.ts`). Resumed windows are bit-identical to uninterrupted ones, in
  desktop Chrome and in the phone's Chrome. The shifted second pass (17.3 → 15.4% character
  errors) awaits a decision. The browser `live` scenario fails here before and after.
- **Emulator install (#23, closed):** Reader is a real WebAPK there, with local-network access
  granted. **Overlay at night (#35, closed):** no app, overlay or setting explained it.
- **Measured, not built:** #16 (Qwen3-1.7B ~83% sense picks, below the 85% bar; 8B ~95%), #10
  (stories best 94.2% known, stiff), #11 (videos best 94.1% known), #29 (FSRS calibrated; misses at
  first meetings and context count; no evidence yet for bike listening). #17: no service death
  since 10-13; watch to 10-19.

## Learning data opens with the last report — deployed

The reader, 2026-10-15: 16 s is fine for a fit, not for opening the page. Learning data now shows
the last visit's report at once ("From …; bringing it up to date…"), kept in `localStorage`
(`ui/kept-report.ts`, 2.6 KB, shape-versioned) and replaced when the fresh one is ready; In force
and the changes load without waiting for it. Fit on this device and Export are enabled at once
and wait for the fresh data if pressed early ("Preparing your learning data…"). Browser `tuning`
(its rule expectation updated to `evidence-4`) and `fithere` pass. `parameters` had failed since
#6: its fixture sets name `ec0e6825`, a fresh profile's `fit-1` baseline, which `fit-2` made
`21f5b1c4`; it now compares them with the id the page shows in force. It also showed a real bug:
until the set in force had loaded, Apply was offered for any imported set, and applying a
mismatched one failed as "a bug". Apply now waits for it ("Checking it against the set in force…").
`parameters`, `tuning` and `fithere` pass. Phone (build `1792080007855`, daily Reader, nothing
applied): a set imported 0.1 s after opening showed "Checking it against the set in force…" at
109 ms; In force appeared at 1,282 ms and Apply anyway 1 ms after (before, Apply was offered for
those 1.2 s); the same set marked as fitted against another set was refused, no Apply, no "bug".
Phone (build `1792079644239`, daily Reader): first visit, nothing kept, report in 15.3 s; second
visit, the kept report in 0.1 s and the fresh one 14.1 s later.

## Learning data and memory recompute 18× faster — fix deployed

2026-10-15, phone: Learning data took 214 s to open (17 s on 2026-10-07). A CPU profile of the
storage worker put 210 s in `wordHistory`'s queries. Reproduced on the laptop from the reader's
backup (restored in memory, documents tokenised greedily over its lexemes: 108,516 tokens, 1,946
words): `tuningDataset` 90 s. Two causes, both per word:

- The drill-sighting query (#36, 2026-10-13) started from every review and walked its document's
  tokens before filtering by word: 80 s. Now the drill reviews are materialized first and only this
  word's tokens joined: 0.9 s, the same rows for every word (416).
- `englishShown` re-read the whole document and each session's translations for every word: 4.8 s.
  One run (a dataset, a memory recompute) now shares them: the dataset byte for byte identical.

`tuningDataset` 90 s → 4.9 s on the laptop; the memory recompute after re-tokenising 137 s → 36 s,
so everyday background recomputes gain too. Of the rest, 2.6 s is the exposure query, already on
indexes; an index on (document_id, kind, from_offset) saved 6 % and is not worth a migration. The
drill test now pins both ends of a drilled line (two boundary mutations caught; they were not
before); 639 tests. Phone (build `1792079046171`, daily Reader): Learning data ready in 16.0 s
(was 214 s), the same figures (2,191 words; later period 163 card answers and 250 in context).

## Fit works again after a hardcore drill — fix deployed

2026-10-15, phone: Fit on this device failed at once with "Invalid modality.": a drill's reviews
carry their session's kind, `hardcore`, which the learning data's validation (`validateDataset`)
did not accept, so any history with a drill could not be fitted on the phone or the laptop. It now
accepts every session kind, and word history types its modality as `SessionKind` instead of casting.
Validation: a storage test exports a history with a drill and runs it through `fitDataset`, red
first with the phone's error and red again with the fix reverted; 639 tests. Also on the phone:
Learning data took 213 s to load (17 s on 2026-10-07), not yet profiled; the streak's "keep it
going" line (#38) showed correct figures but no space before "·", fixed.

After the fix (build `1792076099676`, daily Reader): Fit on this device took 13 s; set 41e69b6d
"did not predict better". The same export fitted on the laptop (9 s, set a1b54faf; ids differ by
platform): 2,184 words, earlier 234 card answers and 1,418 in-context outcomes, later 163 and 250.
Later period, fitted against the set in force (28717ef9): in context −0.0046 log loss per outcome
(95 % interval −0.010 to +0.002), cards −0.0048 (−0.013 to +0.004), so no verdict of better; in
context observed 91.2 %, predicted 92.4 % in force, 93.5 % fitted; cards observed 85.3 %, predicted
84.1 % and 85.0 %. Fitted values against the set in force: seenReading 1.12 → 1.34, tapStability
1.03 → 1.05, rewatch discount 0.5 → 0.36 (half-life 14 days unchanged), falseSuccess 0.075 → 0,
falseFailure 0.045 → 0.034. Not applied: the set in force is already close to calibrated.
#13's headline was seen on the phone: 24 entries, comprehensible-input videos 85–94 %, native
content 57–83 %.

## Predicted comprehension on each video and text (#13) — deployed and phone checked

The figures line under each library entry and on a document's page starts with "~N% understood":
each running word's chance of being understood in context today, averaged over occurrences
(`understood`, `domain/shares.ts`). Recall goes through the set in force's in-context noise,
`falseSuccess + (1 − falseSuccess − falseFailure) · recall`, as the fit scores in-context outcomes;
the Anki baseline has no noise, so until a fitted set is applied it is plain reading recall. New
words count 0, ignored words are left out, a word with no memory but an old known mark counts 1.
Coloured by the band of the figure shown (≥95 % known green, 85 % amber, 70 % red, below dark
red); placement settled as both the library and the document page (#31). Validation: three domain
tests (five mutations each caught) and one repository test that `getMemory` hands on an applied
set's noise (mutation caught); 638 tests, type check, lint; browser `study` passes and shows
"~0% understood · 8 new words" at 390 px.

## Report a problem or idea — deployed and phone checked

**Report a problem or idea** (More → Troubleshooting, and beside Finish session in the reader and
player) opens a dialog: Problem or Idea, a title, a description, and the app's state in four
sections, each previewed and untickable — build, device and storage; this screen (route, and in
the reader the document id, kind, word count and playback position or scroll); the last five
failure records; the latest session's event kinds and timings. Titles, looked-up words and event
details are never included: the repository is public (`src/lib/report/report.ts`, tested with
mutations). Send posts the issue through GitHub's API, labelled `bug` or `enhancement`, with a
fine-grained token (Issues: Read and write on this repository) kept in `localStorage` from the
same Troubleshooting entry, so it works when the database is refused. Bodies are cut per section
to stay under GitHub's 65,536 characters. Browser: `report` scenario (an invalid token's real
request reaches GitHub from the isolated page and its 401 is shown; no issue created). Phone (A71,
build `1792069854879`, daily Reader): the dialog gathered installed, cross-origin isolated, storage
holding, persistent storage granted, bert-ws-zh, five Termux failure records and the latest media
session's 100 events (kinds and timings, no Chinese); an invalid token's send showed GitHub's 401,
and the token was removed after. With the reader's real token: issue #39 created from the phone
(label `bug`, 4,097 characters, no Chinese), then closed.

During a video: the stage covers the button, so it is reached after ☰ (deliberately not on the
stage bar). Opening it from the reader pauses the video and saves the session first
(`Recorder.settled`, bounded at 3 s), so the report has the position and every event up to it;
event offsets count from the first event, since the session row is written after it. Browser:
`reportvideo` (the ☰ setting recorded just before opening is in the report and the video is
paused; without the save on opening it fails). Phone (build `1792071926570`, daily Reader,
document 36 resumed at 279.6 s, 15 s muted): covered on the stage, reachable after ☰; opening it
paused at 295.6 s, and the report had the position and all 14 events up to the ☰ setting, from
+0.0 s, no Chinese. Left with Later.

## Hardcore mode (#36, spec 014) — deployed, phone checked in the test reader

A document's page offers **Hardcore**: a fragment (from the beginning, Continue, or chosen lines),
optionally cut into parts of about N words, with any of four steps run per part in one order —
English preview, watch first, drill, watch after (one engine, not modes; spec 014). Words: new,
due, not yet active (tapped or not) and set aside, never active-not-due or retired by hand;
filters at least x times, among the y most common, a coverage target; most frequent first or story
order (`src/lib/domain/hardcore.ts`). Options are chosen at every start. The drill shows Cards'
faces (now `CardFace.svelte`, shared) with the part's own line and its audio; Again comes back 3
cards later; words passed in a drill today are skipped. Watch steps open the player with `until`
and `back` (it stops at the part's end and offers Back to the session; ← goes back too) or, for a
text, only the part's lines with Done; leaving asks "Before you go" as usual.

Earned data (ADR-0041, contract in the spec): a `hardcore` session holds a `hardcore-plan`,
`hardcore-step` start/end records and the drill's `review`s labelled `hardcore` with the `line`
shown; the player's session gets a `hardcore-watch` link. No migration. Memory: a drill grade is
evidence and enters the fit, but makes no card, no active card and does not end set-aside; a word
is **drilled in** (a reviewed card for good) the first time its reading stability reaches 14 days
from its first drill on. Rule key `known-2+drill-14`: every memory is recomputed once in the
background after the deploy. A drilled line counts as a sentence seen before for `evidence-4`;
drill grades are not first reviews for the new-word budget.

Validation: 629 tests, type check, lint; tests red first and mutation results in
`specs/014-hardcore-drill/quickstart.md`. Browser `hardcore` (new) passes, with `media`,
`autostop`, `leavingvideo`, `documentpage`, `stage`, `study`, `cardaudio`, `cardlayout`. `cards`
fails identically before the change (it expects an Again card back within 20 minutes, predating
no-steps); `resume` expects 9 s for a clip whose fixture copy here has a line at 11 s.

Phone, 2026-10-13, isolated test reader (`verify:isolated --phone`, the 45 s clip; never the daily
reader): the setup page ready 186 ms after the tap (67 words, 3 parts of 21–23 at size 20); both
watch steps stopped at 10.75–10.77 s for a part ending at 10.8 s, Back to the session asked
"Before you go" (answered) and continued at the next step; 24 drill grades (one Again), 52 ms
median and 107 ms worst from a grade to the next card; then part 2 offered; Cards showed 0 due
and 0 new afterwards; Diagnostics showed the plan, steps, 24 labelled reviews and both
`hardcore-watch` links; a backup restored on the device brought the session back whole. Found and
fixed there: the English preview of a video never opened in the player had no English and showed
"…" for ever; it now uses the quick translator for missing lines (with its download progress),
and its effect no longer re-runs on each line it receives (which had kept stopping the
translator). Not measured: a real film's planning time and the one-time memory recompute on the
daily reader — the reader is now using it.

## A streak in study days (#38) — deployed, not yet phone checked

The week card shows "N study days in your streak" (hidden at 0): the study days of the running
week plus those of each completed Monday–Sunday week before it with 5 or more, stopping at the first
week under 5; the running week never breaks it (`studyStreak`, `domain/study.ts`, sharing day
placement and the day-end hour with the week card). While a streak carried from earlier weeks can
still be kept, it adds "· N more days by Sunday keep it going". Derived from history, so backups and
withdrawals agree with it; `studyOverview` now reads all `study-time`/`review` encounters, not 9
days. Day labels are cached per quarter hour (every offset is whole quarters): 50,000 clustered
events take ~90 ms on the laptop (650 ms uncached). Five domain tests and one repository test red
first, three mutations caught; 579 tests. Browser scenario `study` asserts the one-day streak; the
"keep it going" line is checked by type and eye only, not in a browser.

## Phone checks and small fixes of 2026-10-12 — deployed and phone checked

- **No empty copy sent or offered (#22):** a fresh or wiped library sent a copy 30 s after every
  start, which became Termux's newest and stood in front of the copy worth restoring. The app sends
  no copy with nothing earned in it (`holdsNothing`, `backup/format.ts`; it then counts as nothing
  waiting), and the service's `/backup/latest` skips such copies. `empty.test.ts` and two service
  tests red first, five mutations caught; 574 tests. Phone: service updated, `/backup/latest`
  returns the real copy (32 documents, 2,127 words) in 1.2 s; none of the 32 stored copies was
  empty.
- **The reader service started as a Termux task from `.bashrc` too (#17):** Android's exit records
  show every death of Termux was the low-memory killer while Termux had no session or task, so no
  foreground service. Opening Termux started the service inside the terminal session, so it went
  when the session closed. `reader-service-start` runs `reader-service-up` through `RUN_COMMAND`, as
  Termux:Boot and Reader Start do. Phone: with 0 sessions and 1 task Termux stays a foreground
  service and the service answers. Separately, Samsung's `auto_disabler` had disabled Termux:Boot
  (never opened, so "unused"), so this morning's reboot started nothing; opening it once re-enabled
  it.
- **A new version looked for when the app comes back into view (#21):** the installed app is
  resumed, not reopened, so no page loaded and the browser never checked; reproduced on the phone
  (resumed from its icon after a deploy: nothing waiting after 30 s). `UpdateOffer` calls
  `registration.update()` on `visibilitychange`. Browser scenario `resumed` red before, green after;
  `update` still passes. Phone: after the next deploy, resumed from its icon, a page loaded 500 s
  earlier offered the new version after about 10 s.
- **Seven browser scenarios brought up to date (#34):** six expected behaviour from before #31/#32,
  `anki` an old CSS class (`recall-N` since spec 007). All seven pass; harness only.
- **Measured on the phone:** the wake lock fix (#27) held overnight (no Termux wake lock in 13 h
  on battery, 6.5 h of deep sleep, ~2.2 %/h screen off against ~6 %/h); Reader is installed with
  storage kept (#25); the storage handover wait (#19) happens on the phone, 5.7 s against 1.7 s,
  when a page is opened within seconds of the previous one loading; Termux's packages take 627 MB
  (#24), and 25 imported or leftover downloads were removed (3.5 GB → 717 MB).

## A video opens in 1 s instead of 2 s — deployed and phone checked

Issue #1, third cause. A CPU profile on the phone put 1.3 s of opening the player in building the
All lines list: every line, word button and pinyin ruby (22,845 of the page's 22,944 elements for
a 652-line film), hidden behind the stage. The reader (2026-10-12): only what is on screen plus a
little buffer. The stage builds no list; the list builds the lines within 800 px of the screen,
with spacers at their measured heights (`media/line-window.ts`), and following playback scrolls to
a line not built yet by its computed offset. Validation: `lineWindow` properties red first, eight
mutations caught; 571 tests, type check, lint; browser `media`, `stage`, `library`, `autostop`,
`tracks`, `leavingvideo`, `resume`, `documentpage`, `leaving` on a synthetic clip. The list
scenarios now open the player off the stage. `quick`, `sentences`, `translate`, `newsubtitles`,
`listened`, `encounters` and `anki` failed identically before this change and still do. Phone
(build `1791790009088`, the 652-line film at `?t=0`, nothing recorded): stage 0.92–1.07 s (was
2.0–2.1 s) with 101 elements; list 0.94–1.10 s with 10 lines built; scrolled to the middle and the
end, the built lines fill the screen. Still open: ~0.47 s computing every line's words and pinyin
on open, though the stage shows one line.

## Feedback asked only after 10 s of activity (#32) — deployed and phone checked

2026-10-09, the reader: a mere visit does not deserve a grade. Opening a video and leaving it put
a "0 sec recorded" session on Progress asking for feedback: the resume's seek starts a session (a
resume is a new session, the reader's view), and Progress listed every session with a
`session-end`. Progress now lists a session after 10 s of reading or playback, or once answered,
ended or not; leaving asks after the same 10 s instead of 30 s (`FEEDBACK_AFTER_MS`,
`domain/study.ts`). Short sessions already recorded are hidden, not withdrawn. Validation: test red
first, five mutations caught; 567 tests, type check, lint; browser `leaving`, `study`
(`leavingvideo` not run: no subtitled fixture video on the laptop). Phone (build `1791554267336`):
the 0 s test session is gone from Progress; the three listed sessions under 10 s all have saved
feedback.

## Library in 1.6 s instead of 4 s at start — deployed and phone checked

Issue #1, second cause. Timed per storage call over CDP on the phone (three reloads): the library's
4 ms `listDocuments` waited 3.1 s behind the start-up catch-up, which found nothing to do every
time: `reapplyCorrections` 2.5 s, then `staleMemory`'s no-memory-yet query 1.75 s, which also held
the library's shares until ~6.6 s. The catch-up started at the first idle moment, before the library
had asked for anything. Each pass now keeps a fingerprint of what it reads (corrections; documents'
analyzer, upgrade progress and removal; the evidence rule) in the derived `catch_up` table
(migration 005) when it finds everything in order, and is skipped while it matches; the catch-up
waits until the storage worker has been quiet for 1 s (`whenQuiet`). Validation: tests red first,
five mutations caught; 566 tests, type check, lint; browser `boot`, `firstload`, `corrections`,
`study`. Phone (build `1791552075933`): library list at 1.5–1.7 s (was 3.9–4.2 s), shares at ~2.5 s,
the passes 13–24 ms each. Still open under #1: opening storage (~0.6 s) and `studyOverview`
(~0.65 s) before anything shows, the shares' `wordLines` 0.4 s, `wordOccurrences` 0.26 s.

## Continue a video where it stopped — deployed and phone checked

2026-10-09, the reader: closing a video and opening it again started it from the beginning. The
player only ever took a start time from `?t=` (a finished transcript). Now, without `?t=`, it starts
at the start of the line playback last stopped in: the end of the latest `played` stretch
(`lastPlayed`, also under subtitles the video had before, issue #9), not the furthest point that the
library's progress shows. Within 30 s of the video's end it counts as finished and starts over (the
reader's choice over "reached the last line"). The document page says Continue watching, with an
outlined Start from the beginning (`?t=0`) under it; Watch again once finished. Validation: `resumeAt`
and `lastPlayed` tests red first, five mutations caught; 564 tests, type check, lint; browser
`resume` (new; fails with the player's resume removed), `documentpage`, `newsubtitles`, `listened`,
`leavingvideo` (the last two had waited for a video since #31 without pressing Play; they now do).
Phone (build after `a642b4f`, 2026-10-09): the reader confirmed it works.

## A page for each video and text (#31) — deployed and phone checked

2026-10-09, the reader: tapping a video should not start it. Every way into a document now opens
its page (`/document/[id]`): the library, Continue watching, Progress's "Open again", and an import
from New from Termux. The page shows the library's card (picture, watched progress, title, English
title, characters, known/learning/new shares, due and new words; `DocumentCard`, now also the
library's row), Play / Continue watching / Read, the English and Chinese subtitle choice and Delete
(`DocumentSettings`, moved out of the player, which still shows it). Videos and texts share it.
The player's ← still goes to the library; Android back follows history, so it returns to the page.
A finished transcript still opens the player at the line reached. Richer statistics: brainstorm
later (#13). Validation: type check, lint, 560 tests; browser `documentpage` (new; fails when the
library links to the player), `faileddownload`, `lookup`; scenarios that open a document go through
its page (`PLAY` in the harness). `wipe` fails at a Known button the word sheet no longer has
(stale since Retire replaced it, not this change).
Phone (build `1791543736774`, 2026-10-09): library entries link to `/document/N`; document 39 (PAW
Patrol) opened its page from the library with its picture, titles, "1,170 characters · 69% known ·
3% learning · 28% new", "1 due come up (1×) · 133 new words, 13 recur" and Play → `/read/39`, no
horizontal scroll at 411 px; Play itself not pressed, so no session was recorded. No texts on the
phone, so a text's page was checked only in the browser (`leaving`). Delete was a filled button with
muted text, hard to read; now `secondary`, in the player too.

## A failed download says so (#28) — deployed and phone checked

2026-10-09: a share whose yt-dlp fetched nothing stayed at `packing`, showed as "A new video" for
ten minutes and vanished, and its cause closed with the Termux window. `termux-url-opener` now
keeps yt-dlp's non-progress output in `download.log` (not packed into the bundle), and any exit
without a bundle writes `{"stage": "failed", "reason": <last ERROR line>, "url": …}` and still waits
for the service it hosts (the old `exit 1` skipped that). The reader service lists a failed job
whatever its age, titled by the shared address when no title arrived, and does not hold the wake
lock for it. New from Termux shows it as "Download failed. Share it to Termux again." with the
reason and ✕. Validation: `test_service.py` runs the real opener with a stubbed yt-dlp (failed and
packed), plus listing and the wake lock, red first, five mutations caught; browser
`faileddownload` (new; fails with the failed branch removed); type check.
Phone (scripts at `be9eff3`, service restarted 11:06 UTC): a share of a missing video
(`watch?v=zzzzzzzzzz0`) became job 20261009-130659 with `stage: failed`, reason "ERROR: [youtube]
zzzzzzzzzz0: This video is unavailable" and `download.log`; Reader listed it under New from Termux
as "Download failed", and ✕ dismissed it. The wake lock was taken at 13:07:08 and released at
13:08:24, a minute after the failure, not ten.

## 10 s transcription windows (#30) — deployed and checked on the phone

2026-10-08: a PAW Patrol episode transcribed with a fifth of its lines (20 of 102) one-character scraps.
Measured: not the line rule or the window overlap, but speech dropped under music by 30 s windows.
Against human subtitles over 10 minutes, a 熊出没 film went from 44% of characters right at 30 s
windows to 81% at 10 s; a talking vlog stayed at 99% (ADR-0029 amendment). Windows are now 10 s.
Laptop: about a fifth more compute; phone about 19.5 min per 12 min episode, as before. On the
phone the same episodes went from 574 to 1043 and 1011 to 1361 characters; the one-character lines
left are mostly spoken interjections (嗯 嘿 耶 哇), not scraps. Episodes 1–2 were deleted (history
kept) and re-imported, so all four PAW Patrol episodes are under 10 s windows.

## A sentence seen before counts less (`evidence-4`, `fit-2`, #6) — deployed and measured

2026-10-08, the reader: a word understood in a sentence already read or watched may be remembered
from the line, not understood in a new context. An exposure now carries `rewatchDays`, derived in
`wordHistory` from earlier read/played stretches over the same occurrence (withdrawn sessions
included), the freshest of a session's occurrences, absent if any was new. Its Good counts
`1 − d · 2^(−days / h)` of an ordinary one; `d` 0.5 and `h` 14 days are guesses, fitted with the
other strengths (ADR-0037 amendment). A rewatch session no longer counts towards a known card.
Stored `fit-1` sets keep their id and use the guesses; the Anki baseline's id changed. Validation:
memory, replay, fit and a storage test, red first; nine mutations each caught; 560 tests, type
check, lint. Measured on simulated data (400 words, 677 rewatches): the earlier-period loss moves
1.3 of 768 across `d` from 0 to 1, so the fit can barely tell it; expect `d` and `h` to stay near the
guesses for months. Measured on the reader's export (both rules, same 1,939 words): 3,591 of
8,667 exposures are rewatches, 469 of 2,296 untapped Goods; 447 words' stability fell (median
×0.89); known words 181 → 104; reviews due now (13) and within 7 days (53) unchanged.

## Anki words outside the 2,000 most common set aside — deployed and run on the phone

2026-10-07, the reader: Cards showed 253 due, every one an Anki word; the 496 tapped words had none
due. Measured on the phone: Anki words' median general-frequency rank 1,913, tapped words' 6,266.
The reader chose to retire Anki words outside the 2,000 most common, coming back only by coming up
in their reading or watching, as new-word candidates ranked by frequency (ADR-0040 amendment):
`setAsideAnki(top, dryRun)` appends `retired` marks with provenance "set aside: …"; such a word is
`memory.card` 3, never due, a candidate once met (Anki examples do not count), and an ordinary card
after a Reader review. Validation: `set-aside.test.ts` and a memory test, red first; six mutations
(example counted as met, isActive, review before the mark, top ignored, dry run writing, card 3 not
stored) each caught; 553 tests, type check, lint. One full-suite run had `replay.test.ts`'s
property test fail after 344 s; alone (1.8 s) and in a second full run it passed, cause unknown.
Phone (build `1791389180533`, the reader's go-ahead after a dry run of 1,036): 1,036 marks written
in 4.6 s; due 253 → 106; none left to set aside. Without the daily cap 656 new-word candidates,
198 of them set-aside words already met; the other 838 wait to come up.

## Apply a fitted set whatever its verdict — deployed and phone checked

2026-10-07, the reader: the Learning data table did not change after a fit, because no fit could
be applied: 92 later in-context outcomes, under the minimum of 100. The reader reversed ADR-0037's
guard (amendment): Learning data shows each fit's verdict and offers **Apply anyway** when it did
not pass; an altered set or one fitted against another set is still refused. Validation:
`activation.test.ts` red first, browser `parameters` (fails when the refused set shows Apply this
set) and `fithere`. Also measured on the phone: opening Learning data takes 17.3 s before Fit is
enabled (the whole report is built first); not yet profiled.
Phone (build `1791386559854`, 2026-10-07): Fit on this device took 6 s and showed "Set 28717ef9:
too little data while reading." with Apply anyway; not pressed, `b3e07634` stays in force.

## Anki words exported with stability 0 can be graded — deployed, not phone checked

2026-10-06, the reader: grading 要不 on Cards gave "Invalid memory state". The Anki exporter rounded
stability to 0.1 day, and a card without FSRS memory exports its interval, so a card in learning
arrived as `s=0`; ts-fsrs refuses to grade stability 0 with a difficulty. Suspected for 要不, not
confirmed on the phone (no cable). `ankiSeedOf` now raises a seed's stability to ts-fsrs's
`S_MIN`, which repairs words already imported for cards and the FSRS fit alike, and the exporter
writes stability unrounded (the reader's choice: the next import rewrites every Anki word's
provenance once). Validation: a memory test red with the phone's exact error first, and the
exporter test, each red when its fix is removed; 549 tests, type check, lint.

## Termux's wake lock only while a job runs — deployed on the phone

Issue #27, ADR-0020's second amendment. Termux held its wake lock from boot and never released it:
overnight 7h49m held on battery for 33 s of service CPU, about 6%/h with the screen mostly off, and
`termux-wake-lock` keeps a high-performance Wi-Fi lock as well (`docs/battery-drain-investigation.md`).
The reader service now owns the lock: every 15 s it checks for a download (`progress.json` under ten
minutes old, no bundle) or a live `translate.lock`, takes the lock while one runs and releases it
after a minute without one. The scripts no longer take it. Validation: `test_service.py` (job
detection and take/grace/release, red first, four mutations each caught).
Phone (scripts at `d80fdaa`, service restarted from Termux session 1): the old lock was released 61 s
after the restart (Wake Locks size=0, no Termux Wi-Fi lock, Termux still a foreground service); a fake
download folder took the lock after 7 s, with the Wi-Fi lock, and removing it released it after 74 s.
Not yet checked: a night on battery (drain rate, and Diagnostics' restart count — does Android freeze
the idle service without the lock? issue #17), and a real share's download and translation.

## An update no longer deletes the next update's files — fix deployed

2026-10-06, on the phone: after several deploys minutes apart, accepting an update left the active
service worker with an empty precache. An activating worker deleted every other build's cache,
including the newer build already installed and waiting behind it; accepting that one then served
nothing, and every deep link failed with ERR_FAILED, online too (GitHub answers it with status 404,
and the cached shell was gone). Recovered on the phone by unregistering the worker (OPFS data and
the model cache untouched; 91 files precached again). Fixed: `cachesToDiscard` keeps newer builds'
precaches (property test red first), and a navigation with no cached shell fetches it from the
network (`shell` scenario: empties the precache and opens /cards; red first). The test server now
sends the 404.html fallback with status 404, as GitHub Pages does; it sent 200, which hid this.

## Change a video's Chinese subtitles — deployed and phone checked

Issue #9, ADR-0036's amendment. A video's Chinese menu switches among its kept tracks; sharing a
video again whose YouTube id is already in the library replaces it (for documents imported before
spec 012, like Jun's "Hidden Challenges", document 19 on the phone, which kept only its pinyin
track). Either way the reader sees one video: a new document takes the old one's place and date,
the video file is moved, settings and LLM English carried, and the old document is hidden with its
history counting; progress, Continue watching and More's deleted list follow `meta.json`'s
`replaces`, which restore renumbers. Cards take sentences from visible documents first.
Validation: 547 tests (`replaceDocument` and the visible-first card sentence red first, both
mutation-checked), type check, lint; browser `newsubtitles` (new; fails when re-share detection is
removed), `tracks`, `study`, `cardlayout`, `cardaudio`. `media` failed only on its "more than 10
lines" check: this session's fixture clip has 9 cues.
Phone (build after `8df3878`): Jun's "Hidden Challenges" shared to Termux again (job 20261006-013046,
166 MB, tracks zh and zh-Hans) and imported from New from Termux: it opened as document 30 with the
clean "Chinese" track selected and the pinyin one offered in the menu, no pinyin in the lines; the
library still listed 16 entries, the video in its old place at 21% watched, nothing left under New
from Termux. Not yet done: a card sentence needs an encounter in its document, so words met only in
document 19 (记忆) keep its pinyin sentence until that part of document 30 is watched.

## Card fills the page; no Device service row — deployed and phone checked

Follow-up to the leaner Cards page. The Device service row is gone from every tab (Termux's state
still shows in the "Your work isn't being copied" notice and More's Start Termux). The card is no
longer a bordered box: it uses the page, with less space around the counts and the word/sentence
rule; the word shrinks after Show answer, and Retire sits on the Hear row. The buttons are fixed just
above the tab bar (the card stays at the top; a long card scrolls beneath them). Goal: the back of a
typical card (年级, two-line sentence, English) fits above the tab bar without scrolling.
Validation: type check, lint, 545 tests, browser `cardlayout`, `cardaudio`. A browser fit check was
tried and dropped: its card is about 140 px shorter than the phone's, so it passed on the old page too.
Phone (build after `dc9c264`, 411×831, read-only): no Device service row; 年级's back (two-line
meaning, two-line sentence and pinyin, English) ends at 494 px, its buttons at 634, the tab bar at
764, and the page does not scroll (it ended 726 px down, under the buttons, before). Not graded.
After `1b443ee`: the buttons are fixed at 612–747 px on both faces (tab bar 764) whatever the card's
length; 记忆's back ends at 433 px. Seen in passing: 记忆's sentence carries pinyin ("你的记忆好好啊。 Nǐ de jìyì hǎohǎo a.").
It comes from Jun's "Hidden Challenges" video (document 19), imported before spec 012 with only its
pinyin track (95% of cues have a pinyin line); no other document is affected (issue #9).

## Leaner Cards page; card settings in More — deployed and phone checked

A presentation change (ADR-0031). The Cards page is now the counts line ("N due · N new") and the
card: the word, its pinyin, the sentence and the sentence's pinyin, with meanings and English after
Show answer. Removed: the "A word at a time / Cards" heading, "Recall the meaning", "In context"
and the source line, the grading hint, "No recording available". More has a fifth group, **Cards**:
New words per day (same stored value, `src/lib/ui/new-cards.ts`), the Learning data link, and the
count of words waiting for an example (asked for only when the group opens). Validation: type check,
lint, 545 tests; browser `cardlayout` (extended: none of the removed texts, no heading, five groups),
`cardaudio`, `tuning` (now reaches Learning data through More). Phone (build after `3172cf2`,
read-only in the daily Reader): the front of 年级 shows only the word, nián jí, the sentence and its
pinyin, and fits above the buttons; Show answer added the meaning and English (not graded). More
showed five groups, Cards second, with New words per day 10 and 39 words waiting; no horizontal
scroll at 411 px. The back's overflow was fixed next (above).

## Retire words; one-button word sheet; More in four groups — deployed and phone checked

ADR-0040. A **retired** word keeps its memory (reading still updates it, the library counts it by
recall) but is never a card and never due. Cards has "Retire this card" on both faces with Undo,
which restores the previous mark. The word sheet's four state buttons are replaced by one Retire
button (tap again to undo); Ignore is no longer offered, and when the app opens every word already
ignored is retired (an appended mark; provenance "converted from ignored").
More is regrouped into four closed groups: Your words (Anki words and examples, corrections,
deleted documents), Backup & storage, Speech & word splitting, Troubleshooting. Content unchanged.
Validation: 545 tests (the retire rule and the conversion red first, each mutation-checked), type check, lint,
browser `cardlayout` (extended: the sheet's single button, retire → undo, More's groups at 390 px),
`corrections`, `cardaudio`, `boot`. Phone (build `1791238524586`, read-only in the daily Reader):
before the update no word's current mark was `ignored` (latest marks: 2,122 Anki levels, 2 learning,
3 known, 1 unknown; 4,251 events), so the conversion had nothing to do, and after it the marks were
the same with no new failure recorded. Cards showed "Retire this card" under Show answer on 丁; More
showed its four groups closed, no horizontal scroll at 411 px. Retire → Undo was checked in the
browser only, not on the phone (it would add marks to the real history).

## Card front with pinyin and sound — deployed and phone checked

Issue #7, a presentation change under ADR-0031. The goal is understanding what is read and heard,
not recalling pronunciation, so a card's front shows the word and its sentence with pinyin and the
Hear word / Hear sentence buttons (tap to play); the back adds meanings and the sentence's English.
This replaces "Target pronunciation remains hidden before Show answer" (Flashcard presentation,
below). Validation: browser `cardlayout` (updated; failed on the old page) and `cardaudio`. Phone
(build `1791237408088`): an Anki card's front read 丁 · dīng · the sentence with full pinyin · both
Hear buttons enabled; nothing revealed or graded.

## Which words are cards: Anki, known, and new words by general frequency — deployed and phone checked

Issue #5, ADR-0039. Anki-seeded and reviewed words are active cards; a never-tapped word met
untapped in two attentive sessions without English is a known card, also active; a tapped word is a
candidate, picked by the daily "New words per day" budget most frequent in Chinese first (wordfreq's
top 50,000, `src/lib/domain/frequency-zh.txt`, CC BY-SA 4.0), not by library frequency. The library's
due counts cover active cards only. Validation: 543 tests (each rule red first, mutation-checked),
browser `cardlayout`, `cardaudio`, `corrections`, `listened`. The install budget was raised by the
list's 391,486 bytes (check-bundle). Phone (build `1791236846694`): the sweep recomputed 3,505
memories in under a minute; due today 314 (313 Anki, 1 known), 121 known cards, new words 一个, 其,
该, 前, 你们, 不同, 此, 国, 见, 建设; the Gan An video shows "9 due come up (9×)". The deploy first
failed on an unrelated FSRS-6 property test (ts-fsrs rounds recall to 8 decimals); the test now
gives both the same recall (`0b8a6d8`).

## Corrections apply in the order they were made — deployed and phone checked

Issue #2 ("join and split sometimes do nothing"), ADR-0028's amendment. A join or split was dropped
whenever one of its pieces only existed because of an earlier correction: one pass over the
analyzer's tokens could not apply it (智驾 after splitting 乾崑智; 国家 after splitting 万国; 电混合
after splitting 油电混合). Rules now apply in the order of their latest correction, each over the
words the earlier ones left; `reapplyCorrections` brings existing documents up to date when the app
opens; a join or split records `tap-undone` (reason "correction") instead of a lookup. Validation:
536 tests (new ones red first, mutation-checked), browser `corrections`, `cardlayout`, `listened`.
Phone (build `1791232737330`): after the start-up pass, 乾崑 | 智驾 at both occurrences, 万 | 国家,
油 | 电 | 混合, with nothing redone by hand.

## Cards in 0.4 s instead of 9 s — deployed and phone checked

Issue #1 (the app is slow), first cause. Profiled on the phone: 9.05 of the Cards tab's 9.1 s were
one query in `cardsToday` checking each of 67,617 tokens against every earlier encounter in its
document, and since the storage worker answers one call at a time, everything else waited behind
it (Progress: 0.5 s alone, 8.5 s right after Cards). `ENCOUNTERED_WORDS` starts from the evidence
encounters instead: same 3,132 words on the phone's database. A property test compares it with the
old query (four mutations caught); 532 tests, type check, lint. Phone (build `1791219689613`):
Cards 0.35–0.37 s, Progress after Cards 0.47 s. Unchanged and still open under #1: cold start to the
library 3.4–3.6 s, library tab ~1.2 s, opening a video 0.65–1.05 s. The `cardlayout` browser
scenario passes.

## Next line past a short seek; rotation after full screen — deployed and phone checked

Issues #3 and #4 (open work is now tracked as GitHub issues; backlog.md keeps the reasoning). #3:
seeking to 260.59 s in the Gan An Mediastorm video landed at 260.589998 on the phone, so the line
before still counted as playing, and with "stop after each line" ▶ stopped in place every time. The
line at a time now allows 10 ms (`lineAt`, `media/subtitles.ts`). #4: full screen locked landscape
and nothing unlocked it; `media/orientation.ts` unlocks whenever full screen ends and leaves full
screen when the player goes. Validation: 531 tests (both new tests mutation-checked), type check,
lint. Phone (A71, build `1791216891041`, daily Reader): ⛶ then the back gesture returned to
portrait; from line 146 with ❚❚ on, ▶ played line 147 to its end (about 5 s of real playback). The
`listened` browser scenario passes (built with `npm run build`; a `vite build` without postbuild has
no 404.html, so every deep link fails, which is what #26 mistook for stale scenarios).

## Due when FSRS says, no learning steps — deployed and phone checked

ADR-0038. Asked for on 2026-10-04 after "Are Chinese People Rude?" raised the library's due count
from 102 to 123: of 121 words due at the end, 106 sat in ts-fsrs's 10-minute (or 1-minute) learning
step, which reading cannot clear the same day. Every due date is now `last + stability × interval
modifier` days, unrounded (hours for a fresh tap), for reading and cards alike; stability is
unchanged, so the fit and exports are unaffected. The memory key gains `+no-steps`, so the phone's
sweep recomputes every word once. Validation: 527 tests (a property that every memory is due at 90 %
recall caught rounding to whole days), type check, lint, browser `cardlayout`, `parameters`,
`study`. Phone (A71, daily Reader updated to `1a10904`): the sweep recomputed every word within
about a minute; the video's line went from "139 due come up" to "9 due come up (12×)". Of its 506
words with memory, 56 come due within 6 hours (this session's taps) and 424 in 3 days or more.

## Session questions when leaving — built, phone checked on the test origin

Asked for on 2026-10-04: the reader forgets the feedback unless asked. Leaving a video or text
within the app (← Videos/Texts, the tab bar, Android back) after at least 30 s of reading or playing
now pauses, ends the session as Finish session does, and shows a "Before you go" sheet with the
same questions as Progress (`SessionQuestions.svelte`, shared): watched/listened and attention for
videos, "looked up every unknown word" for both. Each answer saves at once; Done and Later carry on
to where the reader was going. Finish session and Delete leave without it; closing the app cannot
wait for a sheet, and Progress's pending card still asks later.

**Found on the way: `onMount` did nothing in the whole app since 2026-09-03.** `vite.config.ts` set
`resolve.conditions` to the onnxruntime condition alone, which replaces Vite's defaults; without
`browser`, `svelte` resolved to its server build, so `onMount` and SvelteKit's
`beforeNavigate`/`afterNavigate` were silent no-ops (`$effect` was unaffected). Now the defaults
plus that condition; the install got slightly smaller (11.460 → 11.439 MB) and the large wasm
stays out. Nothing else used these hooks, so no other behaviour depended on the bug.

Validation: 525 tests (one unidentified test failed once in five runs, then passed three in a row),
type check, lint; browser scenarios `leaving` and `leavingvideo` (new),
`study`, `boot`, `listened`, `parameters`, `cardlayout`, `words`, `shell`, `firstload`,
`readonly`, `fithere` and `tuning` (its expectations were stale since 013: format 2,
`evidence-3`). Phone (A71, isolated test reader): before the fix the sheet did not appear, after it
it did for ← Texts and for the hardware back key; answer saved, Done and Later went on.

## Library word counts: due words and recurring new words — deployed and phone checked

Asked for on 2026-10-04 (backlog: "Video statistics from FSRS"). Under each video's and text's
shares bar: "7 due come up (23×) · 18 new words, 5 recur". Due is reading memory due now (cards
are scheduled on reading; listening only nudges it), counted in distinct words with their
occurrences; ignored words are left out. Since watching updates FSRS, these are the reviews the
video clears, though a tap is still a failed review and a word under shown English stays due. New
is a word with no memory and no mark; it recurs when it occurs in 3 or more separate lines
(`wordLines`, code-point offsets against the text's line breaks). Validation: 525 tests (counts
and lines, each caught 4 mutations), type check, lint, and the `study` browser scenario, now with
a 390 px Texts screenshot (`/tmp/reader-texts-light.png`) showing "8 new words". The due part was
not seen on screen in the browser (a fresh profile has nothing due).

Phone (A71, 2026-10-04, build `1791108314419`): every video has its line, e.g. "Are Chinese
People Rude?" 121 due come up (308×) · 96 new words, 16 recur; the 关税战 summary 228 due (1149×)
· 1130 new, 207 recur; no horizontal scroll at 411 px. The phone was two builds behind: its banner
offered the 09:20 build, and the newer one only after a second `registration.update()` (Pages
sends `max-age=600`). Predicted comprehension is still open.

## Personal FSRS fitting (spec 013) — deployed and phone checked

ADR-0037. **Evidence rule `evidence-3`:** a tap is a failure whatever follows it ("I knew it" is
gone; Undo tap while the sheet is open records `tap-undone` and no lookup). An untapped word under
English the reader saw (revealed line, translated sentence, or a session with English unblurred or
all shown) gets no credit and is no outcome; older sessions count as blurred, older reveals map by
line. **Outcomes:** card grades, and reading in context (a tap 0; an untapped, unhelped word in a
session answered "every unknown word" 1), scored and reported apart; exports are format 2.
**Fit:** `fsrs6.ts` equals ts-fsrs to 1e-6, `replay.ts` reproduces Reader's predictions exactly;
`fit.ts` fits 21 weights, tap/seen strengths and in-context noise on the earlier 80% under a prior
on the Anki weights, and gives a bootstrapped verdict on the later 20%. Run it with
`scripts/fsrs/fit.mjs` or Learning data's **Fit on this device** (own worker, local-model lease,
Cancel, stops when hidden or after 5 minutes). **Apply** only when the set predicted later reading
better with ≥100 outcomes and cards no worse, against the set in force; **Return** to any earlier
set or the Anki weights is always allowed and exact. Changes are append-only `fsrs-activation`s.

Measured: fit of a synthetic 13,500-event export 24.7 s on the laptop, 35 s on the A71 (32 °C),
results within 4.3e-8 (laptop and phone differ in the last bits, so set ids differ). Apply/Return
recompute 2,008 words in 2.1/2.3 s on the A71. A real improvement of ~0.04 log loss per outcome
needed more than 340 later in-context outcomes to show, so Apply will refuse for a while. 522
tests, mutation checks for every rule, browser scenarios `listened`, `encounters`, `parameters`,
`fithere`; phone checks on the isolated origin (word sheet, Learning data, apply/return, fit).

Found and fixed during the phone check (`9152cbb`): Story 1 made the memory sweep loop forever on
words shown English kept from memory, at every app start while visible; Apply/Return now also
recompute at once. Cancel, hide and the deadline of a phone fit were checked in the browser only
(the test profile's fit ends in 0.3 s).

First fit of the reader's real history (2026-10-04, daily Reader updated to `22e4543`, export read
in the page, not saved on the phone): 660 words, 37 sessions 27 Sep–3 Oct, 268 taps, no card
reviews yet. 346 earlier and 87 later in-context outcomes; 1.6 s on the laptop. Later period:
86% understood, today's rule predicted 95%, the fitted set 92% (log loss 0.453 → 0.386). Verdict
"too little data" (87 < 100), so nothing can be applied. The fitted strengths stayed near 1
(seen 1.09, tap 1.06); most of the gain is the noise terms (false success 0.08, false failure
0.04), i.e. today's rule is overconfident about untapped words. Refit once there are a few
hundred later outcomes and some card reviews.

## Player buttons, listening feedback and day end — deployed, not phone checked

Asked for on 2026-10-04 after a bike ride. ◀ now always goes to the previous line and ↻ always
restarts the current one; ↻'s double press is gone. Headphone buttons were already 2× = replay,
3× = previous line. A video session's feedback now also asks "Watched / Only listened" and
"Paying attention? Yes / Partly / No", stored as an append-only `engagement` encounter (latest
wins). These answers are recorded only: they change no memory, and the screen-visibility guess
still decides reading vs listening evidence (reader's choice). Validation: 477 tests, an
`engagement` storage test that caught a mutation, and the `listened` browser scenario.

Progress → This week has "A day ends at" (midnight–6 AM, default 4 AM, kept per device). Activity
before that local hour counts toward the day before, and the week starts at that hour on Monday.
Judged by the local clock hour, so DST nights stay right; a test covers the spring-forward night
where a fixed shift would be wrong. Weekly credit is derived, so changing it rewrites no history.

Recording of visible English, so a later evidence rule can leave words under shown English
neither success nor failure (reader's rule, 2026-10-04; planned for spec 013, not yet applied):
reveals now carry their line's offsets (older ones only a line index), a video session records
its opening stage/blur state (written only with its first real encounter), stage toggles are
recorded, and opening the word sheet's Google Translate link records the sentence's range. The
current evidence-2 rule still gives such words a Good. The Google link wiring was not
browser-checked (it leaves the app); the recorder test covers its range.

## Subtitle track choice — deployed and phone checked

Spec 012 (ADR-0036): Termux downloads every human subtitle track plus automatic Chinese only when no
human Chinese arrived, as `track.<lang>.vtt` with `tracks.json`. Reader picks the clean Chinese
track by content (Jun's pinyin track is named "Chinese (Simplified)") and asks only when there are
two different clean human Chinese tracks or a human English track. A chosen human English track is
matched to Chinese lines by time and shown alone: the reader decided that lines its maker left
untranslated stay empty, so nothing is machine-translated beside it (cards still fall back). Termux
translates at once only when nothing is asked; otherwise after Reader reports the choice.

Local validation: 466 app tests and the Termux suite, a shared case table run by both languages,
mutation checks, type check, lint, and the `tracks` and `media` browser scenarios (the subtitle
question fits 390 px). Phone (Samsung A71, 2026-10-03, app `ad5dbaa`, Termux scripts from the same
commit): two Jun videos imported without a question from the clean track; Grace Mandarin
kOr5UuoKwQg asked, imported with its human English (181 of 188 lines; 7 left empty) and Termux
translated nothing. One Jun translation was stopped by the resource guard (ADR-0032) while a second
download ran; `translate.log` in each job now records why. Not phone-checked: switching English
later, "Transcribe it myself" with a human track, and two clean Chinese tracks.

Findings: Jun and Lazy Chinese put their English inside a Chinese+pinyin+English track, which counts
as mixed Chinese, so their human English is not offered (splitting is an anticipated change). Grace
Mandarin's Chinese track carries traditional and simplified lines per cue; both scripts end up in the
text, as the mixed-track test does not catch two Chinese lines.

## Phone freeze incident — open validation

The reader reported a hot, unresponsive phone on 2026-09-29 that recovered after battery depletion.
The exact cause is not established by surviving logs. Local fixes serialize Termux translations,
supervise model processes, cancel hidden browser speech/quick workers, serialize those workers
across tabs, remove automatic calibration, and bound worker waits. See
[incident evidence and limits](phone-freeze-investigation.md) and [ADR-0032](adr/0032-bound-phone-inference.md).
Local validation: 424 app tests, 9 Termux tests, type checking, lint and production build passed.
These changes require **both** the website update and a separate Termux script update. Installation
and thermal validation are not yet confirmed. Do not repeat heavy phone benchmarks to verify them.
The earlier phone smoke checks below do not certify safety after this incident.

## Offline translation comparison

A 56-input comparison of Reader OPUS, Mozilla/Bergamot and Google ML Kit is recorded in
[offline translation comparison](offline-translation-comparison.md). Mozilla was faster on the
laptop, but all three made substantive meaning errors. ML Kit completed offline on an Android
emulator; the physical phone was not used. No replacement engine has been adopted.

## Sense picker comparison

A 42-item laptop comparison of choosing the CC-CEDICT sense of a word in context is recorded in
[sense picker comparison](sense-picker-comparison.md). Forced to choose among real senses, the
Termux Qwen3-1.7B model got 26/37; offered "none of these fits" it chose that for most words.
Laya multilingual, an open Jev-style model, was ten times faster but near the first-sense baseline.
Gold labels are Claude's and await review; the phone was not used. Nothing was adopted.

## FSRS tuning foundation — deployed

Spec 009 adds **Cards → Learning data**, a read-only report/export of reviewed words' history,
and `scripts/fsrs/evaluate.mjs` for laptop comparison of supplied FSRS-6 candidate weights.
The user confirmed explicit recall as the first measured outcome: Again=failure;
Hard/Good/Easy=success. Existing attentive-encounter scheduling is unchanged. Passive encounters
remain state updates, never measured labels. Predictions are scored before applying the answer;
first, undated and less-than-24h observations are excluded from delayed-retention scores.
Chronological earlier/later periods and separate reading/listening metrics expose data limitations.
See [ADR-0033](adr/0033-fsrs-tuning-outcomes.md) and [usage](../scripts/fsrs/README.md).

Local validation: 51 focused tests passed, seven deliberate mutations were detected, type checking
and scoped lint passed, verification build passed, and a disposable-browser check exercised Cards
navigation, the empty report and JSON export. The browser check caught an initial-load bug before
it was corrected. The laptop CLI evaluated a synthetic 20-review history (19 eligible, split
15/4), including a candidate comparison; these are test results, not evidence of learning quality.
No personal histories, active parameters or Anki data were changed by analysis.

Deployed on 2026-09-30 with commit `4786e13`; Cards → Learning data was opened successfully
in the installed app on the Samsung A71. The report loaded without an error or horizontal overflow.
No personal export was downloaded during this read-only phone check. No optimization runs on the phone. **Automatic fitting and reversible apply/rollback remain future
work**; this slice supplies the data and evaluation foundation. A count alone does not establish
enough data to fit 21 parameters, and repeatedly selecting on the same later period overfits it.

## Study experience — deployed and phone checked

Spec 010 refreshes the library, navigation and light/dark styling, adds continuation and a
Progress screen, and replaces the transient attention modal with **Finish session** and durable,
optional feedback. The question now asks specifically whether every unknown word was looked up;
answers can be corrected later without deleting the original encounter.

A Monday–Sunday five-day goal counts a day after one minute of tracked reading/listening or five
card answers. Grades and lookup answers do not affect rewards. Visible reading is capped at one
minute after the last interaction; listening uses continuous playback adjusted for speed, excluding
seeks and pauses. This estimates participation, not attention or comprehension. Activity and session
endings are retained as encounters; weekly totals are derived, and withdrawn sessions are excluded.
Historical reading durations are not invented. See [ADR-0034](adr/0034-study-sessions-and-weekly-progress.md).

Focused validation covers activity limits, playback speed, duplicate close/retry, feedback replay,
withdrawal, timezone boundaries and backup restore. A browser check exposed a millisecond-loss bug
at the one-minute threshold; recording now uses one clock reading per interval and has a regression
test. All 34 focused tests, type checking, scoped lint/formatting and the verification build passed.
The disposable mobile browser confirmed one study day, feedback persistence and correction after
reload; light/dark screenshots were inspected. Saving feedback keeps its details open. See the
[verification record](../specs/010-study-experience/quickstart.md).

Deployed commit `4786e13` through [successful run 36719898322](https://github.com/EmielLanckriet/language-reader/actions/runs/36719898322).
CI passed type checking, full lint, all 439 tests and the production build. On the Samsung A71,
the installed app and its controlling service worker both reported published build `1790773958309`.
Library, Progress and Learning data loaded in standalone mode at 411px without horizontal overflow;
existing sessions were visible. Synthetic Finish → weekly credit → answer → reload → correction
passed separately on the phone's isolated test origin with a disposable backup service. No synthetic
learning events or feedback answers were submitted in the daily reader.

Phone checks were lightweight, with no inference benchmark. Battery temperature readings ranged
from 34.1°C at the start to 36.2°C at cleanup; this does not resolve the earlier freeze investigation.
The daily Termux service was offline and was not updated in this UI release. Test servers and USB
forward/reverse mappings were removed; `stay_on_while_plugged_in` was restored to `0`. Reader was
left on its library screen.

## Flashcard presentation — Anki layout

The reading cards now follow the local HSK Anki template's hierarchy: large Chinese headword,
green pinyin, serif meanings, and a separate Chinese example/pinyin/translation section on a warm
paper surface, with a matching dark theme. Font stacks use device fallbacks; Anki media and audio
are not imported. Target pronunciation remains hidden before Show answer, preserving the existing
reading prompt. Review settings are collapsed; four distinct grade buttons stay within reach.
Dictionary senses use the contextual pronunciation when available, and late translation results
are checked against the current sentence before display. Scheduling and review writes are unchanged.

This is a reversible presentation fix under ADR-0031. Four existing card-storage tests, type checking,
scoped lint, verification build and the isolated `cardlayout` browser scenario passed. The scenario
imports synthetic text, looks up a word, checks front/reveal, and grades it to completion; light/dark
390px screenshots were inspected. Commit `9b54f8e` deployed through successful run `36721637830`
(type/lint/tests/build gates passed). A redundant run of the same commit was cancelled.
The isolated Samsung A71 check passed at 411px, including one synthetic grade, with model downloads
blocked. Installed Reader then loaded the new card face and Show answer control under published
worker build `1790774830873`, after refreshing the still-open old page. Both sentence and word-only
layouts were inspected. No real cards were graded. Test servers/mappings were removed and the USB
screen-awake setting restored to 0. Reader was left on Cards.

## Flashcard context and audio — deployed and phone checked

Spec 011 prefers examples from actual, unwithdrawn Reader encounters, with original Anki examples
as a fallback. Words without either are deferred from the queue without changing memory. Cards
label their source, retain its identity with reviews, and offer separate word and sentence audio
after reveal. Media examples expand to the full matching subtitle cue and play its bounded interval;
removed/missing media leaves the text usable. Playback stops on grading, navigation and hiding.

The supplementary Anki importer preserves text, translation, pinyin, original fields and recordings
without modifying Anki or Reader scheduling. Example metadata survives logical backup; audio is
stored separately and restored by reimporting the retained bundle. `scripts/anki/export_examples.py`
creates the bundle from a read-only SQLite snapshot. Existing word recordings take priority over
local Mandarin device TTS. No new phone model or paid service is involved.

Local validation: 447 tests and type checking passed; four deliberate mutations were caught.
The actual read-only export contains 2,126 matching examples and 4,032 non-empty audio files
(~167 MiB); two notes whose example omits their headword were skipped and one empty recording is
intentionally omitted. The bundle has been copied to phone Downloads. The initial phone selection
exposed the empty clip and a slow per-header archive scan; no example metadata or audio was
written. Commit `995ad68` retains the example while omitting empty audio and scans archive headers
in 1 MiB chunks. The first actual write was stopped at 21 of 4,032 files because the one-file-per-
clip OPFS design was too slow to leave running on the phone; since metadata is committed last, it
did not add examples to the queue. Commit `fa2cda6` instead stores the selected archive once and
indexes its clips by offset, so a card reads and hash-checks only the clip it needs.

Run `37107896213` deployed `fa2cda6` successfully. On the Samsung A71, the installed app reported
build `1791014104698`, validated the 167 MiB archive (2,126 examples and 4,032 audio clips), and
completed the one-file import with “Examples ready.” The phone remained at 32.5–32.6°C during the
check. A real existing card for 丁 showed its retained Anki example and both audio controls; the
sentence control was invoked without grading the card. The browser verification had separately
confirmed actual playback and grade cancellation. No synthetic review was submitted in the daily
Reader. The temporary debugger mapping was removed; the existing USB screen-awake setting was left
at `2`. See
[verification](../specs/011-context-audio-cards/quickstart.md) and [ADR-0035](adr/0035-card-context-and-audio.md).

## Product and architecture

Reader is a personal Chinese reading and listening app for an Android phone. TypeScript/SvelteKit
builds to a static, offline-capable PWA on GitHub Pages. SQLite in a worker stores learning history
in browser OPFS; media and downloaded models also live on the device. There is no hosted backend.
Termux's local reader service downloads media, retains backup copies, and runs the better English
translation pass. It is a real operational dependency even though hosting is static.

- Dictionary segmentation is immediately usable; the contextual model improves it in the
  background. Pinyin and CC-CEDICT meanings are displayed. Manual join/split corrections persist.
- Texts and offline videos feed a shared encounter history. In-app FSRS reviews maintain reading
  and listening memory. Anki is a read-only seed; Reader does not modify the Anki collection.
- SenseVoice transcribes videos inside Reader, saving each window for resume. Termux no longer
  transcribes. Quick English and the better translation pass share limited phone resources.
- Automatic copies to Termux and restore protect earned history. Deleting a document with history
  hides it while retaining its source text. Sessions can be withdrawn without deleting encounters.
- Recent changes include manual sentence joins, playback progress, session withdrawal, and the
  nested-transaction fix when forgetting a deleted document's sessions.

## Latest maintenance changes

- Spec Kit now has both Claude and Codex integrations installed, with Codex as the default.
  Codex skills live in `.agents/skills`; the existing specs and templates are retained.
- Shared Claude/Codex working rules and the proportionate workflow are recorded in ADR-0031.
- `npm run verify:isolated -- --phone` provides a separate test origin and disposable service;
  synthetic activity must use that setup, not the daily reader.
- A failed transcription checkpoint write now reaches the bounded retry handler instead of
  hanging. Focused regressions cover transient and repeated failures. Real-audio equivalence
  remains a separate open question below.

## Validation of the maintenance changes

Local checks on 2026-09-29: 59 test files / 422 tests passed; type checking and lint passed;
verification and production builds passed. The final recovery adjustment also passed its eight
focused recovery/isolation checks. The isolated browser saved a synthetic text and the disposable
service received its backup; its downloads directory was not linked to personal downloads.
Built bundles were checked for the correct service address in each mode.

The isolated setup was checked on the connected Android phone on 2026-09-29: the test banner
appeared, the built-in 52-character sample saved, and the disposable service received a backup
containing that document. USB reverse mappings worked. Maintenance commit `638d543` was deployed successfully through
GitHub Actions (run 36596561024); the installed reader offered the update and "Update now" was
tapped. USB disconnected before the running version could be read, so final installed-version
verification remains pending. The deployed build ID was `1790698663317`.
The smoke check does not prove the checkpoint failure path on physical storage; that path is
covered by injected-failure regressions.

Device cleanup: `stay_on_while_plugged_in` restored to its previous value `0` after reconnection.
The test servers were stopped. After reconnection, `adb reverse --list` was empty; no test mappings remain.

## Recorded validation and open limits

- Spec 008 records a phone check on 2026-09-29: about 22.4 s per 28 s transcription window in the
  measured setup. Concurrent playback/translation can slow it; see ADR-0029.
- Resumed real-audio transcription differed by two characters in a recorded comparison. The fake
  worker regression proves orchestration, not bit-exact audio decoding. A phone measurement now
  shows that mid-file AAC decoding changes the input samples; decoding from zero matched exactly
  in two control trials. See [investigation](audio-resume-investigation.md). A bounded-memory
  production remedy and its latency tradeoff remain open.
- Long-video Chrome memory growth was not measured in the recorded phone check.
- Segmentation corrections are built; the backlog still lists the real-phone join-and-sweep check
  as pending. The old Claude memory saying spec 004 is on hold is superseded.
- The original browser storage wipe's cause is still unconfirmed. Backup resilience does not
  establish that cause or guarantee every copy is current.
- Sense selection, heteronym readings, listening cards, and learning evidence weights remain
  areas for improvement. See [backlog](backlog.md); weights are hypotheses, not validated learning
  outcomes.

## How to work

Read [working rules](working-rules.md), then the affected feature's documents. The constitution
defines product constraints; this page owns current status. Historical specs and Claude memories
are context, not evidence that a feature is still absent or that a check passed today.

Use Spec Kit for substantial features and earned-data changes. Use a short plan and focused checks
for small reversible work (ADR-0031). Keep decision records when a lasting tradeoff changes.

Run automated phone interactions in the isolated verification setup described in
[browser verification](../scripts/verify-in-browser/README.md). Do not create synthetic learning
events in the daily reader. Keep runs short, batch device checks, and report unverified device
behavior explicitly. Update this page when capabilities or their validation status change.
