# Current state

Updated 2026-10-04. Start here for project status; consult the relevant spec and ADR for detail.
This describes repository behavior and recorded results, not a fresh certification of every feature.

## Spec 013 Story 1: shown English and taps — local, deploying

Evidence rule `evidence-3` (ADR-0037): an untapped word under English the reader saw (a revealed
line, the translate link's sentence, or a session with blur off in the stage or show-all English)
gets no credit; every tap is a failure, "I knew it" is gone, and Undo tap (while the sheet is
open) records `tap-undone` and no lookup. Older sessions count as blurred; older reveals map by line.
Learning data scores reading-in-context outcomes beside card answers; exports are format 2.
Memory is recomputed for every word once (rule change). The parameter ordering bug across devices
is fixed. Deployed `31930b9`; not yet phone-checked (no USB device).

Story 2 (deployed `7f767b2`, laptop only, no visible change in Reader): `fsrs6.ts` equals ts-fsrs
to 1e-6; `replay.ts` reproduces Reader's predictions exactly ~100× faster; `scripts/fsrs/fit.mjs`
fits weights, tap/seen strengths and in-context noise with a prior and gives a bootstrapped
verdict. 5 min 50 s for a synthetic 13,500-event export on the laptop; the reader's real export
has not been fitted. A true improvement of ~0.04 log loss per outcome needed more than 340 later
in-context outcomes to show. Apply/rollback (Story 3) and fitting on the phone (Story 4) remain.

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
