# Current state

Updated 2026-11-07. What the app is and does now, what waits for a phone check, and what is open.
Keep it short: one line per change, replaced rather than appended. The detailed record up to
2026-10-31 is in [history/current-state-2026-10-31.md](history/current-state-2026-10-31.md);
after that, `git log` and the ADRs.

## The app

A personal Chinese reading and listening app for an Android phone. TypeScript/SvelteKit builds a
static, offline-capable PWA on GitHub Pages (deploys on push to `main`). SQLite in a worker keeps
the learning history in browser OPFS; media and models live on the device. No hosted backend.
Termux's reader service downloads videos, keeps backup copies and runs the better translation
pass: a real dependency even though hosting is static.
**On the phone, a native Android app** (ADR-0047, `npm run android`, installed by adb): the same
build in a Tauri shell, its database in a file of its own instead of browser storage, which Chrome
wiped on 2026-11-04 (#54). The PWA keeps deploying for other devices.

## What it does

- **Texts and videos.** Paste a text or import a video from Termux (subtitle track chosen at
  import, or transcribed in the app by SenseVoice in 10 s then 30 s windows, resumable). Each has a
  page with predicted comprehension; videos continue where they stopped.
- **Reading.** Dictionary segmentation at once, a contextual model improving it in the background;
  pinyin and CC-CEDICT meanings on tap, with an optional reason for the tap; a join/split holds
  in the document it was made in only (ADR-0049, #57: 23 s → 0.6–2 s on the phone). Quick English per line, replaced by the Termux translation as it arrives.
- **Memory.** Every encounter feeds reading and listening memory (FSRS, personally fitted under
  More → Cards → Learning data). Anki is a read-only seed.
- **Word status** (spec 019): retired, active or ignored, stored apart from memory. A word becomes
  active at 14 days' reading stability or its first Cards review; only the reader retires or
  ignores.
- **Cards**: active words when due, plus budget picks from tapped retired words. **Hardcore**:
  watch, drill new or due words, watch again, per part of a video.
- **Sessions.** Leaving or finishing after 10 s asks one optional question: Studied it (every
  unknown word looked up) / Just watched or read it / Shadowed it / Skip. Past sessions are under
  More → Sessions and can be withdrawn.
- **Progress**: the week, a streak in study days, every word with its memory, the Taal status.
- **Find videos**, **stories with your due words**, and **spoken stories** (MeloTTS in Termux).
- **Taal challenge** (spec 020, ADR-0045): with a code from Taal, one session per local hour:
  reading and watching as Input, Study when "Studied it", Output when "Shadowed it"; 10 s of Study
  per drill grade; each Cards review as 1.2 cards (10 s at Taal).
- **Safety**: automatic copies to Termux (none exported while Termux is unreachable: every close
  of the app exported the whole library for nothing, #56), as increments after a weekly full copy (ADR-0048), and
  restore; a deleted document with history is hidden, not erased. A copy carries a video's
  downloaded subtitle tracks and English choice too (2026-11-07; before, a restore lost them). Report a problem or idea goes
  to GitHub issues.

## Deployed, waiting for a phone check

- Termux downloads at 360p and keeps the video only inside its bundle (storage: the phone was 96% full).
- Sessions under More; Finish asks like leaving.
- The word list on Progress (#47); how long it takes with thousands of words is not measured.
- An empty sound or video file counts as none (#45).
- A drill card no longer waits on every drill ever made (#41).
- The streak in study days (#38).
- Player buttons, listening feedback and the day end setting.
- Anki words exported with stability 0 can be graded.

## Open

- **Native app**: videos still copied into app storage (one copy, read from Termux's, is next);
  not cross-origin isolated. 22 videos lost in the 2026-11-04 wipe: Termux no longer
  had their bundles. Full screen works again (#55): `FullscreenChromeClient.kt` wraps wry's
  generated client, which cancelled it; after a Tauri upgrade, check wry overrides nothing new.
  Documents 41, 42, 44, 49, 50 failed to re-segment after the restore: a restored document has no
  words, and the check after a batch wanted the whole document covered. Fixed (2026-11-07),
  waiting for the phone app update.

- **Phone freeze (2026-09-29)**: inference is bounded and serialized (ADR-0032); thermal safety is
  not confirmed. Do not run heavy benchmarks on the phone.
- **Speed**: transcription runs as single-threaded WebAssembly in Chrome. Sapling runs the same
  SenseVoice natively in an Android app; measuring native against browser on the phone, and a
  native wrapper (ADR-0007's preserved option), are the candidates.
- Resumed transcription can differ slightly: mid-file AAC decoding changes the samples
  ([investigation](audio-resume-investigation.md)).
- Long-video Chrome memory growth is not measured.
- The cause of the original browser storage wipe is unconfirmed.
- Segmentation corrections: the real-phone join-and-sweep check is pending.
- Sense selection, heteronym readings, listening cards and evidence weights: see
  [backlog](backlog.md). Weights are hypotheses, not validated outcomes.
- Browser scenarios `listened` and `encounters` failed on 2026-10-31 on an improvised fixture clip;
  not investigated.
- Not adopted after comparison: other offline translators
  ([comparison](offline-translation-comparison.md)), an LLM sense picker
  ([comparison](sense-picker-comparison.md)).

## How to work

Read [working rules](working-rules.md). The [constitution](../.specify/memory/constitution.md)
holds the product constraints. Specs and older memories are context, not current status. Automated
phone interactions go to the isolated test reader
([browser verification](../scripts/verify-in-browser/README.md)), never the daily one.
