# Backlog

Open work is tracked as [GitHub issues](https://github.com/EmielLanckriet/language-reader/issues);
this file keeps the reasoning and measurements behind them. Each entry's heading names its issue.
When adding an entry, open its issue; when closing an issue, update or remove its entry here.
Entries newest first.

## Index of open issues (2026-10-08)

Bugs: #1 the app is slow (cold start, library) · #15 pinyin of heteronyms ·
#19 4 s wait on a storage handover · #21 Chrome Reader did not offer its update · #22 restore
offered from an empty copy · #28 a failed download stays at "packing", then vanishes from New.

Important: #29 find which information predicts understanding, and which exposures help.

Cards and memory: #6 weigh encounters in an
already-watched video (built, phone check open) · #18 fit the evidence rule · #20 Anki reset and
live recall.

Library and content: #8 delete a video or text · #9 switch subtitle track after import · #10
generated story with due words · #11 find YouTube videos by due and new words · #13 video
statistics · #14 transcription resume and background pass · #16 word senses in context.

Tooling and checks: #12 flag a problem from inside the app · #17 Termux service dying · #23
emulator install test · #24 Termux install size · #25 store wipe cause.

## Card activation — built as ADR-0039 (#5, closed)

2026-10-05, the reader: the due count is still too high after ADR-0038, because a new video floods
the queue with new words. Proposal, to brainstorm and tweak: a word becomes an active card only
after it was met at least 5 times across at least 2 different videos or texts. Before that it is
not in the card queue, but reading and listening still record evidence, so its memory is there when
it activates. Open: the thresholds; occurrences or separate lines (as the library's recurring words
count); what happens to cards already active that don't meet the rule; whether a lookup activates
a word sooner; whether the library's due counts follow the same rule.

## Which information predicts understanding, which exposures help — #29 (important)

2026-10-08, the reader: wants to learn from the data which inputs predict understanding in context
(for the fit) and which exposures are worth the time (bike listening, rewatching, how many times).
Today an inattentive or listen-only exposure reaches neither FSRS nor the fit, so the data cannot
show it helps. Plan, data estimates and confounders in the issue. The reader's main confounder for
bike listening: how clearly the story comes through by sound alone (Peppa Pig: sound effects,
expressive voices). A randomised choice of bike videos would separate it from rewatching.

## Encounters in an already-watched video — built as `evidence-4` (#6)

Built 2026-10-08 (current-state.md, ADR-0037 amendment): a seen word in a sentence seen before
counts less, by a fitted discount fading with a fitted half-life. Taps unchanged.


2026-10-05, the reader: in a video already watched, a word is understood more easily from memory
of the context or the line itself, and might not be understood elsewhere. So whether an encounter
was in a document (or a line) seen before should change its weight: a success in a rewatch counts
less, a miss more. Probably derivable from earlier encounters (they carry `document_id` and
offsets) without new data; the weight belongs in the fitted evidence rule (#18).

## Card layout: one card per word, sound and pinyin on the front — built (#7, closed)

2026-10-05, the reader decided: one card per word, no separate listening cards. The goal is
understanding written and spoken Chinese, not recalling pronunciation. Front: the word and the
example sentence, written with pinyin, plus audio of both. Back: the same plus the translation.
This changes spec 011's card, which hides pinyin and audio until Show answer. Replaces "Listening
cards: brainstorm first" below.

## Video statistics from FSRS: due words that come up, recurring words — built — #13

Built 2026-10-04 (current-state.md); the open questions below remain.

2026-10-04, brainstorm with the reader. Each video shows, next to the learning count it has now:

- **Due words that come up**: watching updates FSRS, so a video clears the reviews of the due
  words in it. Say "7 due come up", not "7 you'll pass": under `evidence-3` a tap is a failure
  (still a review, so the word is no longer due), and a word under shown English gets no outcome
  and stays due. Count words, with how often they occur beside it ("7 due (23×)").
- **Recurring words**: in 3 or more separate lines (lines, not occurrences, so a line repeating a
  word does not inflate it). New and recurring words are the ones the video itself teaches
  ("18 new (5 recur)"); a due word that recurs after a tap shows whether the lookup stuck.

Not yet decided: a predicted-comprehension headline (mean retrievability over the running words,
new words as 0, e.g. "~94% understood", against the 95–98% known-word range from reading research)
and whether it is cheap enough per video; colouring the numbers with the four retrievability bands
(`memory.ts`); and where the statistics appear (library list or before playing).

## Speech-to-text in Reader with SenseVoice, replacing Termux's whisper — built — #14

Built as spec 008 (ADR-0029), phone-checked on 2026-09-29 (spec.md, "Phone check"): 2 threads by
calibration, 22.4 s per 28 s window, 6.1% character error on a 44 min video against human
subtitles. Termux only downloads and translates, and waits while Reader transcribes (`PUT /busy`).

Open: decoding after a resume is not bit-exact. A transcript resumed at window 5 differed from four
identical uninterrupted runs in two characters, in windows after the resume point; the lines were
all there. Measured 2026-09-29: mid-file decoding changes the input samples, whereas decoding from zero
matched the uninterrupted samples exactly in two trials. See `docs/audio-resume-investigation.md`.
A bounded-memory replay and its startup cost still need evaluation; production resume is unchanged.

2026-09-28, measured (harnesses in `scripts/measure/sensevoice/`): SenseVoice-Small (int8, 239 MB)
running in Reader itself through onnxruntime-web, with 2 threads, number normalisation off, and
30 s windows every 28 s, each keeping its tokens up to the middle of the overlap. Termux stays for
downloading; the reader prefers transcription in the app over Termux.

Measured on Chef Wang (154 s) and the 上海 street interview (231 s):

- **Accuracy**: about as good as turbo, with different errors. SenseVoice got 家常菜, 成色, 浙江工业大学,
  电子信息 where turbo wrote 加重菜, 橙色, 这家工业大学, 电子气息; turbo got 滑好锅 and 明油 where
  SenseVoice wrote 划 and 淋. It keeps fillers (呃 嗯 哦). With ITN on it garbles numbers (20到4000 for
  两千到四千); off, they come out as characters. Nothing invented on Chef Wang's music-only outro.
- **Speed, laptop, 4 threads**: 6.4 s and 9.6 s for the two clips; turbo took 188 s and 345 s.
- **Speed, the A71's Chrome, per 30 s window**: 38.6 s on 1 thread, **22.0 s on 2**, 48.8 s on 3,
  40.4 s on 4. The Snapdragon 730 has 2 fast cores and 6 slow ones, and onnxruntime splits each op
  evenly and waits for the slowest thread, so a thread on a slow core holds up every op. Spinning off
  made 2 threads slower (28.8 s). The laptop scales 3x from 1 to 4 threads.
- **The JS pipeline** (`sensevoice.mjs`) reproduces sherpa-onnx's preprocessing: features equal
  kaldi-native-fbank's to 1e-4, and the text differs only at near-tied tokens (香/鲜: top-two gap
  0.09, against a median of 9.8), which sherpa itself flips between CPUs.

Rejected, measured the same day:

- **Longer windows**: SenseVoice's README gives 30 s as the input limit. At 45, 60 and 90 s the
  interview gained some context fixes (期望, 师兄师姐) and dropped phrases (看一点, 左右), more the
  longer the window; the whole clip at once lost a fifth of its text. Clear speech did not care.
- **Cutting at pauses** (Silero VAD, the README's recommended pipeline): at threshold 0.5 it skipped
  49 s of the interview's real speech, whole answers; at 0.3 still 一千八左右 and 花一千五到两千吧; at
  0.2 it found no pauses and cut at its 30 s maximum. The fixed 2 s overlap instead keeps words cut
  at a boundary whole (师姐啊, 不经常花). Moving the cuts at all reshuffles near-ties elsewhere.
- **Fun-ASR-Nano**: its encoder in SenseVoice form (264 MB) is as fast and clearly worse (家虫菜,
  勤工卷学, about ten errors on the interview). The full model (encoder + Qwen3-0.6B) is broken as
  int8 (empty or looping), and as fp16 (1.6 GB) the most accurate on content words but slow (half
  real time on the laptop), without timestamps, silent above 25 s windows, and it writes fluent
  words that were not said (前功尽弃 for 勤工俭学), the worst kind of error for a learner.
- **sherpa-onnx's own WebAssembly build**: works (29–38 s per window on the phone), but ships no
  threaded onnxruntime; a threaded build means building onnxruntime for WebAssembly ourselves.
- **WebGPU** with the fp32 model (938 MB): the page crashed while loading, likely out of memory.
- **A cloud service**, kept as an option: pay-per-use with a prepaid top-up, no subscription.
  Prices on 2026-09-28: Groq whisper-large-v3-turbo $0.04/h (free tier up to 8 h a day, same model
  as turbo), Alibaba Qwen3-ASR-Flash about $0.13/h, OpenAI gpt-4o-mini-transcribe $0.18/h. A
  ChatGPT subscription includes no API credit.

Open when this is built: the thread count differs per phone, so calibrate once on the device (time 1,
2 and 4 threads, each in its own worker, and keep the best) rather than hard-coding 2. sherpa's
single thread was faster than onnxruntime-web's (about 30 s against 38.6 s), so faster kernels may
exist. A slower, better background pass (ADR-0023) is untested: Qwen3-ASR-0.6B, which sherpa-onnx
1.13.8 can load, or decoding a second time with the windows offset by 15 s and keeping, where the
two disagree, the tokens the model is surer of.

## Pinyin for heteronyms (多音字), and the homograph problem — #15

2026-09-27: pinyin is now shown above every character, from pinyin-pro reading a whole text at a
time, so context decides most readings (银行 háng, 长大 zhǎng, 重要 zhòng, 着急 zháo). Measured wrong
on common words: 长得 cháng (zhǎng), 还钱 hái (huán), 得去 dé (děi), 跑得快 dé (de), 说服 shuō (shuì).
The register's two rows still stand and neither was settled with the segmenter: splitting
heteronyms into lexemes by reading is deferred (anticipated-changes.md, "Split heteronyms"), and
same-reading homographs (花 flower / to spend) are an open problem. For the display alone, a
correction layer (the reader fixing a reading once, remembered per word or per occurrence) or the
contextual model already on the device could improve it.

2026-10-03, measured (`scripts/compare-pinyin/`): pinyin-pro 91.1% on the CPP benchmark, 22/30 on
everyday sentences. g2pM (1.6 MB) 97.3% on CPP but 20/30 everyday and none of the five errors above.
The pip g2pW model (607 MB BERT) fixes all five and gets 28/30, but follows Taiwan readings
(差不多 chā, 和 hàn) and mishandles simplified 干; a mainland-trained model is not what pip ships.

## Word meanings in context — parked — #16

2026-09-27: the word sheet now ranks CC-CEDICT senses (names, variants and archaic senses last; the
pinyin heard in context first) and explains missing words by their parts (`analyzer/gloss.ts`).
Re-measured on the 上海 street-interview video: 1 of 682 words with a poor first meaning, from 117.
The pinyin-based ranking inherits pinyin-pro's mistakes (above): 说服 read shuō picks "to speak".
What it cannot do is choose between same-reading senses (花 flower / to spend) or explain misheard
subtitles (新资 for 薪资, about half of the missing words). Options, most promising first:

1. **The LLM picks the sense** as multiple choice over the numbered CEDICT senses, in the per-line
   translation pass (translate.py). It cannot make up a sense; for a missing word it writes a short
   gloss marked as a guess. Derived data, per document and offset.
2. **A bigger laptop model replaces it in the background** (ADR-0023), and can also flag misheard
   words.
3. **The reader picks the sense** in the sheet: earned, per occurrence (what the recorded occurrence
   exists for), overriding any model, feeding the card's meaning, and ground truth for 1 and 2.
4. **An optional online model**, opt-in only, against the offline principle.

First step when picked up: measure before building. Run Qwen3 1.7B (the phone's) on this video's
words, hand-check about 50 choices, and compare with a 7–14B model on the laptop.

2026-09-28, the reader: a model picks senses only for words that are new or hard at import, plus
every word missing from CC-CEDICT (where misheard subtitles hide), once per word per document.

## Listening cards — superseded by #7

2026-10-05: the reader does not want separate listening cards; one card per word carries the audio
(#7). Kept for the recorded covariates (creator, speed), which #18 can still use.

2026-09-27 (spec 007): left out of 007 on purpose; the reader wants a brainstorm before specifying.
The shape so far: the word is the memory, a sentence is the test. A listening card plays a clip of
the reader's own media containing the word, a different clip each review (one clip would be
memorised), and the reveal shows the line's text, pinyin and English. The creator (already in each
video's meta.json as `uploader`) and the playback speed are recorded on every encounter, as foreseen
covariates: a source's difficulty, for reading evidence (a miss in fast accented speech counts less)
and for picking clips easy first. Listening memory is already kept from lookups and from words
heard with the text hidden, so the history will be there when the cards arrive.

## Termux's service keeps dying: watch whether the process limit was it — #17

2026-09-28: Diagnostics recorded the reader service dying or restarting ten times from 2026-09-26
evening to 2026-09-27 18:52, with Termux already exempt from battery optimisation. Suspected, not
proven (the logs had rolled over): Android 13's phantom process killer. Set over adb, reversible,
not something setup.sh can do: `device_config set_sync_disabled_for_tests persistent`,
`device_config put activity_manager max_phantom_processes 2147483647`,
`settings put global settings_enable_monitor_phantom_procs false`. Chrome was also "background
restricted", so Android killed Reader as soon as it left the front: now `appops
RUN_ANY_IN_BACKGROUND allow` and on the deviceidle exemption list. Samsung's own sleeping-apps
list can still restrict it. Check the "What has happened before" count in a few days: if the
service still dies, the phantom killer was not the cause.

## Transcripts: phrases lost at 30 s chunk boundaries — superseded by spec 008

2026-10-05: about Termux's whisper, which spec 008 removed (`setup.sh` deletes it). Reader's
SenseVoice windows overlap by 2 s and keep each token from the middle of an overlap
(`src/lib/speech/windows.ts`), the fix proposed here.

2026-09-27 (ADR-0019 amendments): each 30 s chunk starts without the text before it, and with
`turbo` one of seven boundaries swallowed a phrase. Longer chunks and one run over the rest are
ruled out, measured: whisper then loops over silence and invents lines. If lost phrases keep
showing up, try overlapping chunks (re-decode a few seconds before each boundary and keep the
better join), measured on the interview first.

## Fit the evidence rule to review outcomes — #18

2026-09-27 (spec 007): the rule's weights are guesses (research R5). Under `evidence-2` a lookup is
Again in both skills, a check is Hard, and a word met untapped in a session answered "I tapped every
word I didn't know" is Good, including words with no memory yet (memory, not a card; the reader
chose that). Only the stretches actually played or on screen count, so quitting halfway credits
only the part seen.

The reader's point (2026-09-27): these are not Anki grades, and forcing each fact into one is the
guess. The log already keeps facts rather than ratings, so the step is in the model: treat
"untapped in a thorough session" as its own kind of evidence with a weight learned from what
follows (later reviews, later lookups of the same word), rather than a fixed FSRS grade. Once months
of in-app reviews exist, fit it and replace the rule by a background recompute over the whole
history. Candidates then: creator and speed as covariates, context diversity (distinct documents)
and library frequency as difficulty priors, and whether such words should ever become cards.

## The attention answer recomputes a session's words while saving waits — #1

2026-09-27 (spec 007, research R14): answering "I tapped everything" recomputes every word of the
session that has a memory, in the same transaction: 0.7 s on the laptop for a heavy synthetic year
(about 250 words a session, 20,000 encounters). If the phone makes this several seconds, move that
recompute into the background sweep: write the answer at once, refresh the words just after.

## A page loaded during a slow storage handover waits about 4 s — #19

2026-09-27 (spec 007): when a new page loads while the previous page's worker is still closing,
`createSyncAccessHandle` refuses (`NoModificationAllowedError`) for over 4 s, the new worker gives up
after its 4 s window, and the client replaces it; the fresh worker then opens at once. Measured in
2 of 3 browser runs, on the build before 007 as well. Pages no longer stay on "Reading…" after it
(the client resends waiting calls), but the ~4.3 s wait remains. Not yet known: whether it happens
on the phone (after an update reload or a share opening a new page), and whether retrying inside
the first worker could ever succeed, which would make the wait shorter than a replacement.

## Anki: a card reset keeps its last level; live recall — #20

2026-09-26 (spec 006): a word reset or deleted in Anki keeps the level of its last import, since
an export only lists studied cards and a missing word is not a judgment. If that matters, the export
could list reset cards and the import retract them. Separately, the levels are a snapshot: a display
of Anki's *current* recall probability (from stability and the days since the last review) would fade
words as they are forgotten, instead of only at the next import.

## A transcript whose Termux died stays stuck — superseded by spec 008

2026-10-05: Termux no longer transcribes (spec 008). Reader resumes a transcript from its saved
windows (`src/lib/speech/transcriber.ts`); its remaining resume issue is #14. A dying Termux service
is #17.

2026-09-26: Android stopped Termux (battery optimisation was already off) during the street
interview's last chunk. The transcriber died with status "228 of 231 s, not done", and the live page
showed "Transcribing: 231 of 231 s" forever. Reader could tell (a chunk running three times longer
than its estimate) and say "Termux stopped: open it to continue"; transcribe.py could resume from
its last chunk instead of starting over; and the reader service, which Termux:Boot starts only at
boot, is gone with it until Termux is opened again.

2026-09-27: part of it is done (ADR-0020's amendment): the likely cause, a wake lock released at the
end of every job and a service orphaned by its script, is fixed, and Reader's Start Termux restarts
the service. Resuming a transcript from its last chunk is not.

## The installed Chrome Reader did not offer its update — #21

2026-09-26: a new build was waiting (its worker answered `which-version` with the new version) but
no "A new version is ready" banner appeared, on reload either. It did appear in a Samsung Internet
tab. Moved over by hand with the worker's `skip-waiting` message.

## The library offers to restore an empty copy — #22

"Your work can be restored … 0 documents and 0 marked words", from a copy a fresh browser tab had
just sent. A copy with nothing in it should not be offered.

## Test install and share-into-the-app on the emulator — needs a Google sign-in — #23

Blocked on 2026-09-25: installing needs a Google account in the emulator's Play Store (logcat:
`WebAPK service unknown_account`), and signing in needs the reader's phone for two-step
verification. Once signed in: update Chrome through the Play Store, install Reader from
https://emiellanckriet.github.io/language-reader/, share a bundle from Termux into it, and check
Chrome's local-network permission prompt for 127.0.0.1:8765 (newer than the emulator's Chrome 124).
Start the emulator with a window (drop `-no-window`, see scripts/android-emulator/README.md) so the
reader can sign in themselves.

## Termux is 724 MB — #24

Mostly ffmpeg's dependencies (mesa, vulkan, X11 libraries, libllvm), which a downloader that only
merges an mp4 and an m4a does not need. Already down from 1.2 GB by skipping recommended packages
(which pulled in clang). Options if it matters: a smaller ffmpeg build, or asking YouTube for a
format that needs no merging (lower quality at 480p).

## The original store wipe: confirm the cause on the phone — #25

Spec 005 is built (copies to Termux, restore, safeguard warnings), so a repeat is recoverable.
The cause is still unconfirmed. The emulator showed the likeliest one: a home-screen **shortcut**
opens standalone like an installed app but gets no storage protection (`persisted()` false), and
Chrome makes a shortcut whenever the real install fails. On the phone: see what the safeguard notice
says; if it says "shortcut", remove the icon and install properly. Also still to do on the phone:
Termux:Boot, a reboot, and a first copy arriving.

## Segmentation corrections (spec 004) — built, phone check pending — #2

2026-10-05, the reader: join and split usually work but sometimes do nothing (#2), and are slow (#1).

Built on 2026-09-27 (plan.md, ADR-0028): join and split from the word sheet, the list with undo
under More. Still to do on the phone: join 一 · 个 under the model, and see that it holds after the
sweep re-derives.
