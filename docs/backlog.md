# Backlog

Things decided but not yet scheduled. Newest first.

## Pinyin for heteronyms (多音字), and the homograph problem

2026-09-27: pinyin is now shown above every character, from pinyin-pro reading a whole text at a
time, so context decides most readings (银行 háng, 长大 zhǎng, 重要 zhòng, 着急 zháo). Measured wrong
on common words: 长得 cháng (zhǎng), 还钱 hái (huán), 得去 dé (děi), 跑得快 dé (de), 说服 shuō (shuì).
The register's two rows still stand and neither was settled with the segmenter: splitting
heteronyms into lexemes by reading is deferred (anticipated-changes.md, "Split heteronyms"), and
same-reading homographs (花 flower / to spend) are an open problem. For the display alone, a
correction layer (the reader fixing a reading once, remembered per word or per occurrence) or the
contextual model already on the device could improve it.

## Word meanings in context — parked

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

## Listening cards: brainstorm first

2026-09-27 (spec 007): left out of 007 on purpose; the reader wants a brainstorm before specifying.
The shape so far: the word is the memory, a sentence is the test. A listening card plays a clip of
the reader's own media containing the word, a different clip each review (one clip would be
memorised), and the reveal shows the line's text, pinyin and English. The creator (already in each
video's meta.json as `uploader`) and the playback speed are recorded on every encounter, as foreseen
covariates: a source's difficulty, for reading evidence (a miss in fast accented speech counts less)
and for picking clips easy first. Listening memory is already kept from lookups and from words
heard with the text hidden, so the history will be there when the cards arrive.

## Transcripts: one whisper run after the first chunk

2026-09-27 (ADR-0019 amendment): each 30 s chunk starts without the text before it, and with
`turbo` one of seven boundaries swallowed a phrase. A prompt cannot carry the context (whisper.cpp
then returns only a chunk's first sentence). The fix without a prompt: after the fast first chunk,
one whisper-cli run over the rest, reading segments from its output as they are printed, so there is
one boundary rather than one per 30 s. Unknown whether whisper.cpp prints each segment promptly on
the phone; measure that first. Worth it only if lost phrases keep showing up.

## Fit the evidence rule to review outcomes

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

## The attention answer recomputes a session's words while saving waits

2026-09-27 (spec 007, research R14): answering "I tapped everything" recomputes every word of the
session that has a memory, in the same transaction: 0.7 s on the laptop for a heavy synthetic year
(about 250 words a session, 20,000 encounters). If the phone makes this several seconds, move that
recompute into the background sweep: write the answer at once, refresh the words just after.

## A page loaded during a slow storage handover waits about 4 s

2026-09-27 (spec 007): when a new page loads while the previous page's worker is still closing,
`createSyncAccessHandle` refuses (`NoModificationAllowedError`) for over 4 s, the new worker gives up
after its 4 s window, and the client replaces it; the fresh worker then opens at once. Measured in
2 of 3 browser runs, on the build before 007 as well. Pages no longer stay on "Reading…" after it
(the client resends waiting calls), but the ~4.3 s wait remains. Not yet known: whether it happens
on the phone (after an update reload or a share opening a new page), and whether retrying inside
the first worker could ever succeed, which would make the wait shorter than a replacement.

## Anki: a card reset keeps its last level; live recall

2026-09-26 (spec 006): a word reset or deleted in Anki keeps the level of its last import, since
an export only lists studied cards and a missing word is not a judgment. If that matters, the export
could list reset cards and the import retract them. Separately, the levels are a snapshot: a display
of Anki's *current* recall probability (from stability and the days since the last review) would fade
words as they are forgotten, instead of only at the next import.

## A transcript whose Termux died stays stuck

2026-09-26: Android stopped Termux (battery optimisation was already off) during the street
interview's last chunk. The transcriber died with status "228 of 231 s, not done", and the live page
showed "Transcribing: 231 of 231 s" forever. Reader could tell (a chunk running three times longer
than its estimate) and say "Termux stopped: open it to continue"; transcribe.py could resume from
its last chunk instead of starting over; and the reader service, which Termux:Boot starts only at
boot, is gone with it until Termux is opened again.

2026-09-27: part of it is done (ADR-0020's amendment): the likely cause, a wake lock released at the
end of every job and a service orphaned by its script, is fixed, and Reader's Start Termux restarts
the service. Resuming a transcript from its last chunk is not.

## The installed Chrome Reader did not offer its update

2026-09-26: a new build was waiting (its worker answered `which-version` with the new version) but
no "A new version is ready" banner appeared, on reload either. It did appear in a Samsung Internet
tab. Moved over by hand with the worker's `skip-waiting` message.

## The library offers to restore an empty copy

"Your work can be restored … 0 documents and 0 marked words", from a copy a fresh browser tab had
just sent. A copy with nothing in it should not be offered.

## Test install and share-into-the-app on the emulator — needs a Google sign-in

Blocked on 2026-09-25: installing needs a Google account in the emulator's Play Store (logcat:
`WebAPK service unknown_account`), and signing in needs the reader's phone for two-step
verification. Once signed in: update Chrome through the Play Store, install Reader from
https://emiellanckriet.github.io/language-reader/, share a bundle from Termux into it, and check
Chrome's local-network permission prompt for 127.0.0.1:8765 (newer than the emulator's Chrome 124).
Start the emulator with a window (drop `-no-window`, see scripts/android-emulator/README.md) so the
reader can sign in themselves.

## Termux is 724 MB

Mostly ffmpeg's dependencies (mesa, vulkan, X11 libraries, libllvm), which a downloader that only
merges an mp4 and an m4a does not need. Already down from 1.2 GB by skipping recommended packages
(which pulled in clang). Options if it matters: a smaller ffmpeg build, or asking YouTube for a
format that needs no merging (lower quality at 480p).

## The original store wipe: confirm the cause on the phone

Spec 005 is built (copies to Termux, restore, safeguard warnings), so a repeat is recoverable.
The cause is still unconfirmed. The emulator showed the likeliest one: a home-screen **shortcut**
opens standalone like an installed app but gets no storage protection (`persisted()` false), and
Chrome makes a shortcut whenever the real install fails. On the phone: see what the safeguard notice
says; if it says "shortcut", remove the icon and install properly. Also still to do on the phone:
Termux:Boot, a reboot, and a first copy arriving.

## Segmentation corrections (spec 004) — built, phone check pending

Built on 2026-09-27 (plan.md, ADR-0028): join and split from the word sheet, the list with undo
under More. Still to do on the phone: join 一 · 个 under the model, and see that it holds after the
sweep re-derives.
