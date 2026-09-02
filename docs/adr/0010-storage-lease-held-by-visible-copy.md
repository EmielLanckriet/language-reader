# ADR-0010: The Storage Lease Is Held By Whichever Copy Is Visible

**Status**: Accepted
**Date**: 2026-09-02
**Relates to**: ADR-0003, ADR-0007, ADR-0008; Constitution Principle II, Principle V; slice 1 plan

## Context

ADR-0008 put the reader's data in SQLite-WASM over the OPFS SAH-pool VFS, and its addendum recorded
the consequence: the worker holds an exclusive lease on the database files. Slice 0 shipped with a
mitigation that turned out to be no mitigation at all — a second copy that lost the race fell back
to an in-memory database and **kept working perfectly**, accepting documents and marks that
vanished on reload. It named the likely cause in a notice and then carried on.

That is acceptable while data is disposable. Slice 1's spec ends that: retained source content is
earned from now on. FR-016 states the guarantee the whole slice exists to serve — no change is ever
reported as saved unless it is durably recorded.

The constraint is not incidental. The SAH-pool VFS locks every file it will use at registration,
deliberately; the library's own documentation explains that this is why registration is not
automatic. A second copy therefore cannot open the database **even to read it**. So detection alone
cannot satisfy FR-014, which requires that saved content stay readable: it produces an honest notice
over an empty library, which looks exactly like the data loss the slice is meant to remove the fear
of.

Two facts, both established rather than recalled, opened the question up:

1. `@sqlite.org/sqlite-wasm` 3.53.0 provides `pauseVfs()` and `unpauseVfs()`. A holder can
   relinquish its handles leaving the files intact, and another copy can then acquire them.
   `pauseVfs()` throws if any database handle is still open, so the connection must be closed first
   — sequencable, because the worker owns exactly one.
2. `SharedWorker` — the textbook answer — reached Chrome for Android in milestone 148, April 2026.

## Decision

**A copy holds the storage lease only while it is the visible one.**

On becoming hidden it closes the database and pauses the VFS. On becoming visible it unpauses and
reopens. A copy that cannot acquire the lease enters an explicit read-only state: it accepts no
write at all, states the cause, and retries when the reader next acts or asks.

The decision logic is a pure state machine in `src/lib/storage/availability.ts`, written test-first.
`navigator.locks` is taken alongside the VFS **for the sole purpose of naming the cause** — a
refused lock means another copy, an acquired lock over a failing VFS means this device. Exclusivity
is enforced by the VFS itself; treating the advisory lock as the guarantee would be a false one.

## Alternatives Rejected

**Exclusion only — detect, refuse, explain, retry, and amend FR-014.** The smallest possible change,
and it was seriously considered. Rejected because of what it does to the reader: they tap the
home-screen icon, a browser tab is open somewhere they have forgotten about, and their library is
gone. Honest and alarming, at precisely the moment this slice is meant to make the application feel
trustworthy.

**A negotiated handover over `BroadcastChannel`** — the copy that wants the lease asks, the holder
yields. Strictly more capable: it works even when two copies are genuinely visible at once, which
visibility-yielding does not. Rejected on cost. It needs a message protocol, fencing against
in-flight writes, a timeout for a holder that never answers, and recovery from both copies having
paused. That is more machinery than the rest of the slice combined, to cover a case that barely
arises on a phone, and Principle IV asks that an increment stay small enough to discard.

**A `SharedWorker` holding one connection for every copy.** This is what the problem is shaped like,
and it is newly available on the target platform. Rejected on the Intent to Ship's own caveat:
*"SharedWorker instances might terminate unexpectedly, for example, when a Chrome app is moved to
the background and then foregrounded."* Backgrounding and foregrounding is the entire life of a
phone reading application. Founding this slice's data-safety guarantee on the newest and least
settled capability available inverts the purpose of the slice. Recorded as **available rather than
rejected permanently**: it becomes the natural implementation if the spec's anticipated move from
exclusion to sharing ever happens.

**Reading the database file directly, bypassing the VFS.** The SAH pool stores data in opaque
fixed-size files with its own header and filename mapping. There is no SQLite file on disk to open.

## Consequences

**Easier, and better than expected.** The read-only state stops being the routine consequence of
having a forgotten tab open and becomes what it should be — real, rare, and worth reading. No
protocol between copies exists, so none of its failure modes exist either. Backgrounding now closes
the database cleanly rather than leaving it open for the operating system to reclaim, which is an
incidental durability gain.

**Harder.** `db.ts` must become open-and-closeable rather than opened once for the life of the page,
and every write path gains a refusal branch. There is a brief unavailability while returning to the
foreground, during which the interface must show something honest rather than a stale library.

**The ordering hazard worth naming.** A mark made at the instant of backgrounding must not be
acknowledged and then discarded by the pause. It is safe because the worker serialises its requests
— the pause queues behind the write — but this is the exact shape of the bug the slice is about, so
it is written down rather than left to be rediscovered.

**What is not established.** This is the one part of slice 1 whose behaviour on a real Android
device rests on documentation rather than measurement. `pauseVfs()` and `unpauseVfs()` were
confirmed present in the installed library and their semantics quoted, but they have not been
exercised across a real backgrounding. The implementation order puts this fourth of eight rather
than last, so that discovering otherwise leaves room to fall back to exclusion-only and amend
FR-014.

**Revisit if.** Pause and unpause prove unreliable on the device; or several copies need to operate
at once, at which point a `SharedWorker` — by then better settled — is the shape to reach for.
