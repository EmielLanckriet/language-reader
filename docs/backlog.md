# Backlog

Things decided but not yet scheduled. Newest first.

## Is Qwen3-1.7B overkill for subtitle translation?

It is 1.83 GB of the ~3.2 GB Termux footprint (ADR-0021), more than everything else combined. Check
whether something smaller translates subtitle lines about as well: a dedicated zh→en model (e.g.
opus-mt-zh-en through CTranslate2, ~80 MB), Qwen3-0.6B, or a Q4/Q5 build with one line per prompt
(the Q4 1.7B merged lines at 20 per prompt, so the failure may be the batching, not the model).
Compare on the same few minutes of real subtitles: alignment kept, English a learner can use, and
speed on the phone.

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

## Segmentation corrections (spec 004) — on hold

`specs/004-segmentation-corrections/` is specified but not planned or built. Paused on 2026-09-25 to
get to a usable product first (meanings, translation, video and audio). Pick it back up after that.
