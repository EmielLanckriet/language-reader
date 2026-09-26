# Backlog

Things decided but not yet scheduled. Newest first.

## A transcript whose Termux died stays stuck

2026-09-26: Android stopped Termux (battery optimisation was already off) during the street
interview's last chunk. The transcriber died with status "228 of 231 s, not done", and the live page
showed "Transcribing: 231 of 231 s" forever. Reader could tell (a chunk running three times longer
than its estimate) and say "Termux stopped: open it to continue"; transcribe.py could resume from
its last chunk instead of starting over; and the reader service, which Termux:Boot starts only at
boot, is gone with it until Termux is opened again.

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

## Segmentation corrections (spec 004) — on hold

`specs/004-segmentation-corrections/` is specified but not planned or built. Paused on 2026-09-25 to
get to a usable product first (meanings, translation, video and audio). Pick it back up after that.
