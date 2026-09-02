# Data Model: Installable, Offline, and Safe From Silent Loss (Slice 1)

**Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md) | **Research**: [research.md](./research.md)

## No schema change

This slice adds no table, no column, and no migration. `001-initial.sql` is untouched.

That is worth stating rather than leaving implicit, because it is what makes the slice cheap under
Principle V: nothing accumulates in a shape that would later need migrating. What changes is what
the application **refuses to do**, which is behaviour, and behaviour is free to change.

The hedge columns recorded in slice 0 — `provenance`, device identity, the per-device counter — are
unused by this slice and stay unused. They become load-bearing when export or a second device
arrives, per the spec's Anticipated Changes.

## Classification of what this slice does introduce

Per Principle V and ADR-0003, everything persisted must be classified. Nothing here is persisted,
and that is the classification:

| Thing | Earned / Derived | Where it lives | Survives a reload? |
|---|---|---|---|
| Storage availability | Neither — a condition of the moment | Memory, in the tab | No, and must not |
| Pending change awaiting a retry | Neither — a in-flight intent | Memory, one at a time | No |
| Version readiness | Derived | The service worker's own registration | Rebuilt on load |
| Cached application files | Derived | The browser's cache store | Yes, and rebuildable |

The one entry that could tempt someone to persist it is **the pending change** — the mark the
reader made while the copy was read-only, which FR-015 says must be carried out if the retry
succeeds. It is held in memory, for the duration of one attempt, and is dropped if the attempt
fails. Holding it any longer would violate FR-012's "nothing is held in the hope that storage
becomes available".

---

## State machine: storage availability

This is the part Principle II makes test-first. It is modelled as a pure function so that it can
be, with no browser, no worker, and no timing.

**Module**: `src/lib/storage/availability.ts` — imports nothing.

### States

| State | Meaning | Accepts writes? | Reader sees |
|---|---|---|---|
| `acquiring` | An attempt to take the lease is in flight | No | Nothing; it is brief |
| `holding` | The lease is held and the database is open | **Yes** | Normal application |
| `paused` | Released deliberately, because this copy is hidden | No | Nothing; no one is looking |
| `refused` | An attempt was made and failed | No | The read-only notice (FR-013) |

`refused` carries a cause:

| Cause | Meaning | What the reader is told to do |
|---|---|---|
| `another-copy` | The lock was held elsewhere in this origin | Close the other copy |
| `unavailable` | The lock was free; the storage engine still would not open | Something is wrong with this device or browser; the recorded reason is shown |
| `unknown` | Neither could be established | Say so plainly, and show what was recorded |

The three causes exist because FR-013 requires distinguishing the first two *where knowable* and
admitting the third *where not*. `unknown` is not a failure of the design; it is the honest answer
the clarification asked for, and omitting it would force a guess.

### Events

| Event | Raised by |
|---|---|
| `became-visible` | The document's visibility changed to visible |
| `became-hidden` | The document's visibility changed to hidden |
| `reader-attempted-change` | The reader marked a word or saved a document |
| `reader-asked-to-retry` | The reader used the on-demand control (FR-015) |
| `acquire-succeeded` | The lease was taken and the database opened |
| `acquire-failed` | It was not, with a cause |

### Transitions

```text
                 became-hidden
      holding ───────────────────────> paused        (close db, then pauseVfs)
         ^                                │
         │ acquire-succeeded              │ became-visible
         │                                v
      acquiring <───────────────────── (attempt)
         │  ^         became-visible      ^
         │  │         reader-attempted-change
         │  │         reader-asked-to-retry
         │  └─────────────────────────────┤
         │ acquire-failed(cause)          │
         v                                │
      refused(cause) ─────────────────────┘
```

Written as rules, which is how the tests read:

- `holding` + `became-hidden` → `paused`
- `paused` + `became-visible` → `acquiring`
- `refused` + `became-visible` → `acquiring`
- `refused` + `reader-attempted-change` → `acquiring`, **remembering the change**
- `refused` + `reader-asked-to-retry` → `acquiring`
- `acquiring` + `acquire-succeeded` → `holding`, **performing any remembered change**
- `acquiring` + `acquire-failed(cause)` → `refused(cause)`
- `holding` + `became-visible` → `holding` (no-op)
- `paused` / `acquiring` + `became-hidden` → `paused`
- Anything else → unchanged

### Invariants the tests assert

1. **Writes are accepted in exactly one state.** `acceptsWrites(s)` is true if and only if
   `s.kind === 'holding'`. This is FR-012 and FR-016 stated as one line, and it is the reason the
   state machine exists at all rather than a pair of booleans.
2. **No timer appears anywhere.** Every transition is caused by the reader or by the browser
   telling us about visibility. This is FR-015a, and it is checkable by reading the event list:
   there is no `tick`.
3. **A remembered change is carried out at most once, and only on success.** FR-015 says the reader
   must not have to repeat the action; FR-012 says nothing may be held hoping storage returns. Both
   hold because the memory lasts exactly one attempt.
4. **`refused` is never terminal.** From it, three different events lead back to `acquiring`. This
   is the spec's edge case "being read-only is a condition of the moment, never a state the
   application gets stuck in".
5. **A cause is always present on `refused`.** There is no unlabelled read-only state, because a
   notice that cannot say why is the silent failure this slice exists to remove.

### The one ordering hazard

The reader marks a word at the same moment the application is backgrounded. The mark must not be
reported as saved and then discarded by the pause.

This is safe because the worker processes one request at a time: `pauseVfs` is queued behind the
write, and the write's acknowledgement is what the interface reports. The hazard is recorded here
rather than left to be rediscovered, because it is the exact shape of the bug this slice is about.

---

## State machine: version readiness

Much smaller, because the platform supplies most of it.

| State | Meaning | Reader sees |
|---|---|---|
| `current` | No newer version has finished installing | Nothing |
| `ready` | A newer version is installed and waiting | An offer to move to it (FR-010) |

- `current` + `worker-waiting` → `ready`
- `ready` + `reader-accepted` → the new worker is told to activate, and the page reloads

There is deliberately no `installing` state exposed to the reader. A version that has not finished
installing cannot be moved to, so announcing it would only invite a tap that does nothing.

**FR-009 needs no state at all.** A waiting worker does not activate; that is what waiting means.
The running application keeps its version because nothing takes it away.

---

## Entities named in the spec

The spec names two, and both are runtime conditions rather than records:

- **Application version** — `$service-worker`'s `version`, used for the cache name so that a new
  deployment writes a new cache and the old one is deleted on activation.
- **Storage reachability** — the state machine above. Never stored, by requirement.
