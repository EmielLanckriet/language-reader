# ADR-0020: Earned Data Is Copied To Termux, As A Versioned Snapshot

**Status**: Accepted
**Date**: 2026-09-25
**Relates to**: ADR-0003 (earned versus derived), ADR-0007 (no server), ADR-0017/0019 (Termux),
spec `005-survive-storage-wipe`

## Context

The reader lost everything once, when the phone's storage for the app was reset. The cause is
unknown: persistence was requested, but a shortcut, a reinstall or cleared site data would each get
past it. The app is now used daily, so every mark is earned data that nothing can recompute. A web
app on Android cannot write outside its own storage without the reader acting, and there is no
server. Termux is already on the phone for imports.

## Decision

**A full snapshot of earned data and retained inputs is sent, as versioned JSON, to a Termux service
on `127.0.0.1:8765` that Termux:Boot starts at boot.** It is sent 30 s after changes stop, when the
app goes to the background, and at least every 5 minutes. The service keeps 20 recent copies plus
one per day for 30 days. A restore takes the latest into an empty store in one transaction, and is
checked by replaying the event log. The same service also serves transcripts (ADR-0019) and
bundles, so Termux runs one long-lived process, not two.

**The copy is a logical format, not the database.** Lexemes appear as `(language, surface)`, and
documents and devices keep their ids. The format carries its own version and is upgraded by pure
steps, so SQL migrations never have to know about it.

## Alternatives Rejected

- **A file the reader exports by hand.** It is reliable and needs no extra app, but it is always out of
  date on the day it is needed. Deferred, not rejected: it is the second implementation of the same
  destination seam, and the answer to losing Termux itself.
- **A file saved to Downloads periodically.** Chrome shows download prompts and notifications, and
  files pile up.
- **Copying the SQLite file.** It is exact, but opaque, tied to the schema version, and full of derived
  tokens.
- **Incremental copies of new events.** Smaller, but a single lost increment corrupts every restore
  after it.
- **Copying videos.** They are 40–70 MB each, and Termux already keeps every bundle. The copy
  records where to find them.

## Consequences

- **Easier:** a wipe of the app's storage costs at most about 5 minutes of marking. Spec 004's
  corrections join the format without a new version.
- **Harder:** Termux:Boot is a second F-Droid app to install. Android may stop the service; the app
  warns, and opening Termux restarts it. A wipe of Termux itself is not recoverable by this design.
- **Harder:** Chrome's local-network permission is needed for the copy as it already is for
  transcripts. It is untested until the emulator has a Google account.
- **Revisit if** the service proves unreliable on the phone: add the manual export behind the same
  seam.
