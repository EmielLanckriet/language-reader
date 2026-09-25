# Backlog

Things decided but not yet scheduled. Newest first.

## Termux is 724 MB

Mostly ffmpeg's dependencies (mesa, vulkan, X11 libraries, libllvm), which a downloader that only
merges an mp4 and an m4a does not need. Already down from 1.2 GB by skipping recommended packages
(which pulled in clang). Options if it matters: a smaller ffmpeg build, or asking YouTube for a
format that needs no merging (lower quality at 480p).

## Survive the phone's store being wiped

At some point the persistent store on the phone reset and everything was gone. `persist()` is
already requested (`src/lib/storage/persistence.ts`), so that alone was not enough — or was denied.
A lead from the emulator: in a plain Chrome tab (not the installed app) the app shows "The browser
has not promised to keep your saved reading" — persistence is denied there. If the phone ever ran it
as a shortcut instead of an install, the data was evictable. Check that first. Causes still to tell apart: persist denied, the app being uninstalled or reinstalled, site data
being cleared, the deploy origin changing, or a migration. Whatever the cause, the fix is probably
a copy of the earned data (states, events, corrections) kept somewhere the origin's storage does not
own: an export or automatic backup file, or sync. Find the cause first; then build the backup.

## Segmentation corrections (spec 004) — on hold

`specs/004-segmentation-corrections/` is specified but not planned or built. Paused on 2026-09-25 to
get to a usable product first (meanings, translation, video and audio). Pick it back up after that.
