# ADR-0045: Study time is sent to the Taal challenge
Status: Accepted. Date: 2026-10-26. Spec 020. Leaves [ADR-0007](0007-no-server-browser-first.md)
in force.

Taal is a friend's app with a weekly challenge among friends: points a day for minutes of Review,
Input, Output and Study. The reader signs in to it from this app once, and from then on this app
adds its own share to the reader's Taal log without being asked: Input and Study minutes and Cards
reviews per study day (spec 020's mapping). Only those numbers leave the device.

- **An optional tier, not a server.** Like the LLM key, it is the reader's own account on someone
  else's service; nothing here depends on it, and the app works the same without it, offline or
  signed out. ADR-0007 is about what this app needs to run; that has not changed.
- **Sign-in through `firebase/auth`, and nothing else of Firebase** (`firebase` 12.19.0, pinned).
  Taal signs in with Google only, through its Firebase project; the library is Google's way to get
  that session, and writing the OAuth exchange and token refresh here would make the
  security-sensitive part this app's code, and need a second setting from the friend. Measured
  (13.1.0, minified): auth alone 139 KB (35 KB gzipped), with the Firestore client 602 KB, with
  Firestore lite 261 KB. It is loaded in its own chunk, only to connect or send. The friend adds
  this app's address to the project's authorized domains.
- **The log is read and written over the database's REST interface**: read, add the changes,
  commit only the changed fields under the read's `updateTime`, again on a conflict. Taal's page
  saves its whole log when the reader edits a number, so a blind write would replace hand entries
  and a blind increment could not stop at zero.
- **What was sent is earned data.** `taal_sent` (day, mode, amount) records what an outside
  system received, which nothing here can recompute; it is in the copy (format 5), so a restore
  never sends a day twice. Sending itself is per device and off after a restore until turned on
  again; a connect sends from its own day on, never earlier days the reader may have entered by
  hand.

Why: the reader, 2026-10-26: "That way I don't have to manually track it, which I know I won't do
properly." The friend agreed.

Taal's format was read from its published page, not from a documented interface (spec 020,
research R1); when it changes, sending fails visibly on Progress and keeps what is pending.

Alternatives: the token copied by hand out of Taal's storage (unsupported, a long-lived key to the
whole account); the full Firebase SDK (four times the size for one document); writing the group
leaderboard too (the reader accepted that it catches up when Taal is opened).

## Revised 2026-10-31, before it shipped: Taal's connect code instead of signing in

Taal published a contract for other apps on 2026-10-29 (`connect/README.md` on its site): the
reader makes a code in Taal (Settings → Connected apps) and pastes it here; the app sends sessions
with stable ids and totals, which Taal adds next to the reader's own entries. This replaces the
sign-in, the read-merge-commit of the reader's log and `taal_sent`:

- No `firebase` dependency and no authorized domain to ask the friend for.
- One session per local hour (`taalSessions`), so none crosses a day end; sending one again
  replaces it, and an emptied hour is sent empty, which Taal removes. What was sent is kept per
  device in `localStorage` only to send less; losing it costs a resend, not a double count. So it
  is not earned data: migration 007 and copy format 5 were dropped, and a restore no longer turns
  sending off.
- `src/lib/taal/send.ts` is Taal's `sendToTaal()` as published; the guide asks that its request
  shape not be changed.

The bullets above on sign-in, the log's REST interface and `taal_sent` describe the first build,
which never deployed.
