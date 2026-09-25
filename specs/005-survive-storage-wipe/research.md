# Research: The Reader's Work Survives A Storage Wipe

Each item records what was decided, why, and what else was considered. Items marked **measure** are
guesses until checked, and the task list checks them.

## R1. Full snapshot, not incremental

**Decision**: Each copy is a complete snapshot of earned data and retained inputs, written whole.

**Rationale**: The data is small. Word states, events and documents' text for a year of reading are
kilobytes to a few megabytes. A whole snapshot is atomic by construction, needs no merge logic,
and can be checked on its own. The receiver keeps several, so a bad copy never replaces the only
good one.

**Alternatives**: Shipping only new status events. The event log is append-only, so this is possible
and would be smaller. But restore would then need every increment, and a lost one corrupts
everything after it. Rejected for a first version; revisit if a snapshot ever passes about 5 MB.

## R2. A logical format, versioned apart from the SQL schema

**Decision**: The copy is JSON describing *records* (documents, lexemes by surface, word states,
events, devices), not a dump of SQLite tables. It carries its own `format` version. Restore reads
any earlier format and writes through the current repository.

**Rationale**: FR-009 and SC-005 require old copies to restore into new versions. Tying the copy to
migrations would make every migration a copy migration too. Lexeme identity is already
`(language, surface)` (migration 001's unique index), so words need no ids in the copy.
Documents and devices keep theirs, because events point at them. FR-013 wants it readable by a
person, and JSON is.

**Alternatives**: The SQLite file itself. It is exact and trivial to write, but opaque, tied to the
schema version, and it copies derived tokens too. A SQL text dump was rejected for the same reasons.

## R3. One Termux service at boot, for the copy and for transcripts

**Decision**: `scripts/termux/reader-service.py`, started by Termux:Boot
(`~/.termux/boot/reader-service`). It listens on `127.0.0.1:8765`. `PUT /backup` stores a copy,
`GET /backup/latest` returns the newest, and `GET /downloads/...` serves Termux's download folders.
That covers live transcripts (ADR-0019) and bundles for restoring videos. `transcribe.py` stops
starting its own server; it already skips serving when the port is taken, and now it always will be.

**Rationale**: Two long-lived servers on two ports would be two things to keep alive and two
warnings to explain. One also makes transcripts work without the transcriber owning the port.

**Alternatives**: A second port only for backups. That is simpler to add, but it is two processes.
Starting the service from `.bashrc` alone does not survive a reboot without Termux being opened;
it is kept as the fallback after Android kills the service (see R7).

## R4. Where the copy is made and sent

**Decision**: The storage worker builds the snapshot in one read transaction, and the page sends it.
A send happens 30 s after the last change to earned data, when the app goes to the background, and
at least every 5 minutes while there are unsent changes.

**Rationale**: SC-002 allows 5 minutes. Waiting 30 s after the last change batches a burst of marking
into one copy. Sending when the app goes to the background covers the likely end of a session.
The page, not the worker, sends it, so the Local Network Access permission (R6) is asked in a
context that can show it.

**Alternatives**: A copy after every mark. That is excessive and competes with marking (SC-003).
Periodic only: it misses a session that ends with the app being closed.

## R5. Telling a shortcut from an install

**Decision**: `display-mode: standalone` for an installed app, and anything else counts as not
installed. Storage protection comes from `navigator.storage.persisted()`, which is already
requested.

**Rationale**: The emulator showed the failure mode. When Chrome cannot install the WebAPK, it
falls back to a shortcut, which opens in a browser tab. There `display-mode` is `browser` and
persistence is denied. **Measured 2026-09-25, and the expectation was wrong**: a Chrome home-screen shortcut
reports `display-mode: standalone`, exactly like an installed app, with `persisted()` **false**. So
`display-mode` only tells a browser tab from the rest. The shortcut is caught by storage protection:
standalone but not persisted means a shortcut, and the notice says so. This is the likeliest cause of
the original wipe; it can only be confirmed on the phone.

## R6. Chrome's Local Network Access prompt

**Decision**: Treat the permission as a one-time setup step. The first send asks for it. A refusal
counts as "copy missing" (FR-011), with the warning naming the site setting to change.

**Rationale**: Newer Chrome asks before a public site talks to `127.0.0.1`. ADR-0019 already depends
on the same permission for transcripts, so this slice adds no new kind of dependency.
**Measure**: blocked until the emulator has a Google account (docs/backlog.md).

## R7. When Android stops the service

**Decision**: Setup also adds a guard to `~/.bashrc`: opening Termux starts the service if it is not
already running. The app's warning says "open Termux once".

**Rationale**: The reader's own words: a service that starts at boot is fine, and any other manual
step is hassle. This keeps the recovery to one tap.

## R8. Videos after a restore

**Decision**: The copy lists each media document's source address and YouTube id. After a restore,
the app asks the service for a bundle with that id and re-imports the video from it. If none is
found, the document reads without its video and says so.

**Rationale**: Termux already keeps every downloaded bundle, so copying 40–70 MB per video again
would buy nothing. From now on `termux-url-opener` records its job folder name in `meta.json`.
Older bundles are found by the YouTube id in their `meta.json`.

## R9. Restore is one transaction into an empty store

**Decision**: Restore validates the whole copy first: parse, format version, integrity hash, and
references between records. Then it writes everything in one transaction: devices, documents with
their ids, events. Word states come from `rebuildProjection`, and are then compared with the
copy's word states, which must match exactly (FR-007). Tokens are derived afterwards by the fast
analyzer, and the sweep upgrades them as usual. The restore refuses unless the library holds no
earned data (FR-010).

**Rationale**: All or nothing (FR-008). Replaying the event log and checking it against the copy's
states is FR-007's own definition, so it doubles as a runtime check.

**Alternatives**: Merging into a non-empty library. That is needed only after a partial loss, and it
is where silent overwrites live. Refusing with an explanation is enough for a first version.
