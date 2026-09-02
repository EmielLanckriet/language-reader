# Implementation Plan: Installable, Offline, and Safe From Silent Loss (Slice 1)

**Branch**: `002-installable-offline-reader` | **Date**: 2026-09-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-installable-offline-reader/spec.md`

## Summary

Slice 0 shipped an application that works and is not usable daily: the home-screen icon opens a
browser, reading needs a network, and a second copy silently discards work. This slice fixes those
three and adds no reading capability.

The approach, after [research](./research.md):

- **Installable** — a static web app manifest whose member URLs are all relative, so the same file
  is correct at `/language-reader/` and at `/`. Plus an in-application install offer, which doubles
  as a live check that the application actually qualifies (FR-003b).
- **Offline** — a hand-written service worker precaching the entire 2.6 MB build. Measurement
  closed the spec's one open assumption: it fits comfortably, so no partial strategy is needed.
  Version changes ride the service worker's own `waiting` state, which *is* FR-009 already.
- **Safe from silent loss** — a copy holds the storage lease only while it is the visible one,
  releasing it on backgrounding and reacquiring on return. The copy the reader is looking at
  therefore works; a copy that genuinely cannot get the lease refuses every write and says why.

One thing not in the spec is included because this slice makes it expensive: **1.08 MB of the
build is a duplicate copy of SQLite that never executes**, pulled in by a single import in
`session.ts`. Precaching would bake it into every install and every version change.

## Technical Context

**Language/Version**: TypeScript 6.0, Svelte 5.56 (runes), SvelteKit 2.63, Node 24.20.0

**Primary Dependencies**: `@sqlite.org/sqlite-wasm` 3.53.0 — unchanged. **This slice adds no runtime
dependency.** Per Principle V a new one would need a named justification, and none earns it.

**Storage**: SQLite-WASM in OPFS via the SAH-pool VFS, inside a dedicated worker (ADR-0008).
Unchanged, except that the lease is now acquired and released rather than held for the page's life.

**Testing**: `vitest` 4.1 for the state machine and the manifest invariant; `fast-check` 4.9 is
available but this slice's state space is small enough that enumerated transitions are more
readable than generated ones (Principle VII).

**Target Platform**: Android Chrome on a phone, installed to the home screen. Served as static files
from GitHub Pages at `/language-reader/`.

**Project Type**: Installable, offline-capable web application. No server, no backend, no API.

**Performance Goals**: SC-001 — reading a saved document within 30 seconds of tapping the icon with
the device offline. The precache is 2.6 MB across 28 files, all local by then.

**Constraints**: No control over HTTP headers, so no COOP/COEP and therefore no `SharedArrayBuffer`
— this is why the SAH-pool VFS is the only OPFS option and why its exclusivity is a constraint
rather than a choice. Deployment is under a subpath, so no absolute URL may be baked into a static
file. Offline reading is constitutional, not optional.

**Scale/Scope**: One reader, one device, no accounts. Documents up to 5,000 characters.

## Constitution Check

*Checked against constitution v1.4.0 before Phase 0, and re-checked after Phase 1 design. Both
passes below.*

| Principle | Verdict | How |
|---|---|---|
| **I. Every Slice Ships To The Phone** | **Pass, and it is the gate** | [quickstart.md](./quickstart.md) P1–P12 are phone-only, and SC-008 makes this explicit in the spec. Slice 0 is why: the icon-opens-a-browser defect was invisible until someone tapped it. |
| **II. Test-First On State Transitions** | **Pass** | The availability state machine is written test-first as a pure module. See the note below — it is not on the constitution's mandatory list, and that is not a conflict. |
| **III. Anki Is Authoritative** | **Pass, vacuously, and checked rather than skipped** | No Anki code exists in the repository. Nothing in this slice reads, writes, or opens a collection. Governance says a gate passing without checking Principle III is invalid, so it is checked. |
| **IV. Vertical Slices Only** | **Pass** | Spans storage (lease acquisition), the pure layer (availability), and the interface (three notices, one disabled-control explanation). No horizontal phase. |
| **V. Modular By Seam, Flat Within** | **Pass — no new seam** | The four mandatory seams are untouched. Nothing here needed a fifth, which the spec named as the signal that the slice had grown. See the two judgement calls below. |
| **VI. Decisions Are Recorded** | **Pass** | ADR-0009 (offline shell and installability) and ADR-0010 (the storage lease) are written during this plan, not after. |
| **VII. Readable Over Clever** | **Pass** | The service worker is hand-written and about fifty lines. Workbox was rejected — see below. |

### Principle II: why availability is tested although the list does not name it

The constitution's mandatory list is closed — *"the following, and only the following"* — and
storage availability is not on it. The spec nonetheless requires test-first here, on the grounds
that read-only mode governs whether writes are accepted.

There is no conflict. The list mandates a **minimum**, and its exemption is for *"UI components,
wiring, and glue code"*. A state machine that decides whether earned data is kept is none of those.
Recorded explicitly because the alternative reading — that anything unlisted is exempt — would
exempt exactly the thing this slice exists to get right.

### Principle V: two judgement calls

**`availability.ts` is a new module inside `storage/`, not a new abstraction layer.** Principle V
forbids *"an interface with one implementation"*. This is a concrete pure function over a closed set
of states, extracted so that it can be tested without a browser. Nothing implements it; nothing is
configured by it. Had it been left inside the worker, the Principle II obligation could only have
been met with a browser harness.

**`persistence.ts` is an extraction, not a new structure.** It moves one existing function out of
`db.ts` so the main thread stops dragging in SQLite. It removes a dependency rather than adding an
indirection.

Both trace to the anticipated-changes register through `docs/anticipated-changes.md`'s "What Slice 0
Revealed" entries on the exclusive lease and the missing manifest.

### Principle VII: Workbox rejected

Workbox generates a service worker from configuration. Rejected on three counts: it is a new
dependency needing a named justification under Principle V and does not earn one; the generated
worker is exactly the artifact Principle VII's source-versus-artifact clause does *not* protect,
since it would be committed and read rather than regenerated from a readable source; and the
behaviour needed here is one `addAll`, one cache sweep, and one cache-first `fetch` handler. Fifty
readable lines beat a dependency whose defaults would have to be studied to know what it does.

## Project Structure

### Documentation (this feature)

```text
specs/002-installable-offline-reader/
├── plan.md                          # This file
├── spec.md                          # Clarified 2026-09-02
├── research.md                      # Phase 0
├── data-model.md                    # Phase 1 — the two state machines
├── quickstart.md                    # Phase 1 — validation, laptop and phone
├── contracts/
│   ├── web-app-manifest.md
│   ├── service-worker.md
│   └── storage-availability.md
├── checklists/requirements.md
└── tasks.md                         # /speckit-tasks — not created here
```

### Source Code (repository root)

```text
src/
├── app.html                          CHANGED  manifest link, theme colour
├── service-worker.ts                 NEW      precache, cache-first, skip-waiting
├── lib/
│   ├── domain/                       untouched — the seam earning its keep again
│   ├── analyzer/                     untouched — the slice adds no reading capability
│   ├── content/                      untouched
│   ├── storage/
│   │   ├── availability.ts           NEW      pure state machine (Principle II)
│   │   ├── persistence.ts            NEW      requestPersistentStorage, out of db.ts
│   │   ├── lease.ts                  NEW      Web Lock + VFS acquire/release; worker-only
│   │   ├── db.ts                     CHANGED  loses persistence; open/close now repeatable
│   │   ├── worker.ts                 CHANGED  drives the state machine, gates writes
│   │   ├── client.ts                 CHANGED  surfaces availability, refuses writes
│   │   ├── protocol.ts               CHANGED  visibility, retry, availability messages
│   │   └── session.ts                CHANGED  imports persistence; forwards visibility
│   └── ui/
│       ├── registerServiceWorker.ts  NEW      manual registration, for FR-010
│       ├── InstallOffer.svelte       NEW      FR-003a
│       ├── UpdateOffer.svelte        NEW      FR-010
│       └── ReadOnlyNotice.svelte     NEW      FR-013, FR-015
├── routes/
│   ├── +layout.svelte                CHANGED  hosts the three notices
│   ├── +page.svelte                  CHANGED  FR-017 — the disabled save control explains itself
│   └── diagnostics/+page.svelte      CHANGED  FR-018 line; read-only cause detail
static/
├── manifest.webmanifest              NEW      all member URLs relative
├── icon-192.png                      NEW
├── icon-512.png                      NEW
└── icon-maskable-512.png             NEW
tests/
├── storage/availability.test.ts      NEW      the state machine, written first
└── build/manifest.test.ts            NEW      no member URL begins with "/"
scripts/check-bundle.mjs              NEW      one sqlite3.wasm in build/, or fail
vite.config.ts                        CHANGED  kit.serviceWorker.register = false
docs/adr/0009-offline-shell-and-installability.md   NEW
docs/adr/0010-storage-lease-held-by-visible-copy.md NEW
```

**Structure Decision**: Unchanged from slice 0. `src/lib/` holds four modules matching the
constitution's seams, `tests/` mirrors it, and nothing in `domain/` learns that any of this
happened. That last point is the check worth watching during implementation: if a change to how
storage is leased reaches into `domain/`, the seam has failed and the fix is there, not here.

## Implementation Order

Ordered so that each step is independently verifiable and the riskiest thing is not last.

1. **Remove the duplicate SQLite.** Extract `persistence.ts`; assert one `sqlite3*.wasm` in the
   build. Everything after this caches the right thing.
2. **Manifest and icons.** Ship, install on the phone, confirm P1–P4. This is the fastest route to
   a phone-visible result and the cheapest thing to get wrong invisibly.
3. **Availability, test-first.** The pure module and its tests, with no worker involved.
4. **Lease acquire and release.** Wire `availability.ts` into the worker; make `db.ts` open and
   close repeatably. Verify locally with two visible windows (quickstart 10–12).
5. **Service worker.** Precache, cache-first, navigation fallback. Verify offline locally (6–7).
6. **Update offer.** The `waiting` detection and the skip-waiting control (8–9).
7. **The three notices, and FR-017 and FR-018.** Interface work, once the states they report exist.
8. **Phone check.** P1–P12, with P5 first.

Step 4 is the one that can fail in an unfamiliar way; it is deliberately not last, so there is room
to fall back to exclusion-only and amend FR-014 if `pauseVfs`/`unpauseVfs` misbehave on the device.

## Complexity Tracking

No Constitution Check violation requires justification. The two Principle V judgement calls are
recorded above rather than here, because neither is a violation — one is an extraction and the
other is a concrete module, not an abstraction.

**One spec amendment came out of analysis rather than planning.** FR-014 originally required that
saved content stay readable in the read-only state. The storage engine cannot deliver that — a copy
without access has none for reading either — so the requirement was amended to state what this
design actually guarantees: the copy in front of the reader is the one that reaches storage, and a
copy that cannot reach it says so *in place of* the library rather than showing an empty one. The
trade was explicit when the approach was chosen; the spec had simply not caught up. Recorded here
because a plan that quietly implements something weaker than its spec is the failure mode this
project's whole process exists to prevent.

One risk is worth naming without a table around it: **the visible-copy lease is the only part of
this plan whose behaviour on a real Android device is not established by measurement.**
`pauseVfs()` and `unpauseVfs()` were confirmed present in the installed library and their
documented semantics are quoted in research.md, but they have not been exercised here across a
real backgrounding. Step 4's position in the order exists so that finding out is not the last thing
that happens.
