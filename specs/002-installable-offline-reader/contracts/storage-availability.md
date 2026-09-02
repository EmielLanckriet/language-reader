# Contract: Storage Availability

**Pure module**: `src/lib/storage/availability.ts` — imports nothing, testable in Node.
**Impure caller**: the storage worker, which raises the events and performs the effects.

The state machine itself is specified in [data-model.md](../data-model.md). This file fixes the
shape of the boundary.

## The pure part

```ts
export type Cause =
  | { kind: 'another-copy' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'unknown'; reason: string };

export type Availability =
  | { kind: 'acquiring' }
  | { kind: 'holding' }
  | { kind: 'paused' }
  | { kind: 'refused'; cause: Cause };

export type Event =
  | { kind: 'became-visible' }
  | { kind: 'became-hidden' }
  | { kind: 'reader-attempted-change' }
  | { kind: 'reader-asked-to-retry' }
  | { kind: 'acquire-succeeded' }
  | { kind: 'acquire-failed'; cause: Cause };

/** The next state, and what the caller must do to get there. */
export function next(state: Availability, event: Event): { state: Availability; effect: Effect };

export type Effect = 'none' | 'acquire' | 'release' | 'perform-remembered-change';

/** True in exactly one state. FR-012 and FR-016 in one line. */
export function acceptsWrites(state: Availability): boolean;

/** What the reader is told. FR-013. */
export function explain(cause: Cause): { headline: string; action: string; detail?: string };
```

`explain` returns text rather than a symbol so that FR-013 — *"MUST say which, because the two call
for opposite actions"* — is assertable in a unit test. The interface renders what it returns and
adds no wording of its own.

## The impure part

The worker supplies the two effects, and nothing else crosses this boundary:

| Effect | What the worker does |
|---|---|
| `acquire` | Ask for the Web Lock with `{ ifAvailable: true }`; install or unpause the VFS; open the database. Raise `acquire-succeeded` or `acquire-failed`. |
| `release` | Close the database, **then** `pauseVfs()`. In that order — the library throws if handles are open. |

### Determining the cause

| Lock | VFS | Cause reported |
|---|---|---|
| refused | not attempted | `another-copy` |
| acquired | throws | `unavailable`, with the thrown message |
| acquired | throws, and the lock state has since changed | `unknown`, with the thrown message |

The Web Lock is **advisory only**. Exclusivity is enforced by the VFS, which locks its own files.
The lock exists to name the cause, and treating it as the guarantee would be a false one.

## The message protocol addition

`src/lib/storage/protocol.ts` gains:

| Direction | Message | Meaning |
|---|---|---|
| page → worker | `{ type: 'visibility', visible: boolean }` | Drives `became-visible` / `became-hidden` |
| page → worker | `{ type: 'retry' }` | The on-demand control (FR-015) |
| worker → page | `{ type: 'availability', state: Availability }` | Pushed on every change, so the interface never asks |

**Reads are queued, never refused.** A read arriving while the state is `acquiring` or `paused`
waits for `holding` and is then served. Only writes consult `acceptsWrites`.

Every existing write call gains one refusal path: when `acceptsWrites` is false, the worker raises
`reader-attempted-change`, waits for the resulting attempt, and then either performs the call or
rejects it. The caller therefore never receives a success it will not keep — which is FR-016, and
the reason the retry lives here rather than in the interface.
