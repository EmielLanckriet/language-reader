# Implementation Plan: Reader Walking Skeleton (Slice 0)

**Branch**: `001-reader-walking-skeleton` | **Date**: 2026-09-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-reader-walking-skeleton/spec.md`

## Summary

The thinnest end-to-end path through every layer: paste Chinese text, store it on the device, show
it split one character per token, tap a token to assign a state from a menu, and find everything
unchanged on return — deployed and used on a real phone.

Technically this is a single TypeScript application with no server. SvelteKit builds it as a static
site; SQLite compiled to WebAssembly stores data in the browser's origin-private file system; the
domain core is plain TypeScript that imports neither. The analyzer is a deliberate placeholder that
splits text into single characters, sitting behind the interface a real segmenter will later use.

Most of the schema serves no visible capability in this slice. That is the point: it is earned data
or a one-way door, and the disposable nature of slice 0's contents lowers the stakes of getting the
shape wrong without licensing its omission.

## Technical Context

**Language/Version**: TypeScript 5.x, targeting ES2022 (needed for `Intl.Segmenter` later and for
string iteration by code point)

**Primary Dependencies**: SvelteKit with Svelte 5 and `@sveltejs/adapter-static`; Vite;
`@sqlite.org/sqlite-wasm` for storage. No backend framework, no ORM, no server.

**Storage**: SQLite compiled to WebAssembly, persisted in the origin-private file system (OPFS).
Schema applied by numbered plain-SQL migrations. See [research.md](./research.md) for why this
rather than IndexedDB.

**Testing**: `vitest` as runner; `fast-check` for property-based tests. Test-first is mandatory for
word state transitions, history replay, and token tiling invariants (Constitution Principle II).

**Target Platform**: Android Chrome, phone-first. Also usable on a desktop browser. Built as a
static site; home-screen installation and offline caching arrive in slice 1.

**Project Type**: Single-page web application, statically hosted. No client/server split, because
there is no server.

**Performance Goals**: A 2,000-character document renders within 2 seconds on a phone (SC-002).
Tapping a token and choosing a state shows the change within 200 ms (SC-003).

**Constraints**: No server, and nothing requiring a payment method (ADR-0007). Documents capped at
5,000 Unicode code points (FR-020). All reader data stays on the device. Offsets are Unicode
code points, never UTF-16 code units.

**Scale/Scope**: One reader, one device, tens of documents, low thousands of tokens per document.
Cross-device is explicitly out of scope for this slice.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-checked after Phase 1 design.*

Evaluated against constitution v1.4.0.

| Principle | Gate | Status |
|---|---|---|
| **I. Every slice ships to the phone** | The plan must contain a deploy step and a phone check, not merely local verification. | **PASS** — deployment and the phone check are explicit tasks; SC-008 makes the slice incomplete without them. |
| **II. Test-first on state transitions** | Tests written before implementation for state transitions, history replay, and segmentation invariants. Segmentation asserted on invariants, never expected outputs. | **PASS** — three test suites precede their implementations. Merge/split and Anki payloads are absent from this slice, so those list items do not apply. |
| **III. Anki is authoritative and read-mostly** | No writes to the Anki collection. | **PASS (vacuous)** — this slice does not touch Anki in any way. |
| **IV. Vertical slices only** | The slice must span storage, domain, and interface. | **PASS** — every user story crosses all three. |
| **V. Modular by seam, flat within** | The four named seams respected; no speculative generality; the domain core free of framework and storage imports. | **PASS with one note** — see below. |
| **VI. Decisions are recorded** | Architectural choices made during planning produce ADRs. | **PASS** — the storage-engine choice produces ADR-0008. |
| **VII. Readable over clever** | Plain over idiomatic; generated artifacts judged by their source. | **PASS** — no code generation in this slice; SQL migrations are hand-written and readable. |

**Principle V note.** Three of the four seams are exercised here: the *language provider* (the
character-splitting placeholder, which is its second implementation and therefore demonstrates the
seam rather than asserting it), the *content source* (pasted text), and *domain core isolated from
delivery* (enforced by test, below). The fourth, *SRS export targets*, has no instance in this
slice and is not stubbed — stubbing it would be exactly the speculative generality Principle V
forbids.

**Enforcement, not intention.** Principle V.4 is checked by an automated test asserting that no
file under `src/lib/domain/` imports from Svelte, SvelteKit, or the storage layer. A principle
verified by a test is a principle; one verified by good intentions is a preference.

## Project Structure

### Documentation (this feature)

```text
specs/001-reader-walking-skeleton/
├── plan.md              # This file
├── research.md          # Phase 0: decisions taken before design
├── data-model.md        # Phase 1: entities, schema, invariants
├── contracts/           # Phase 1: the seam interfaces
│   ├── analyzer.md      # Language provider contract
│   ├── content-source.md# Content source contract
│   └── repository.md    # Storage contract
├── quickstart.md        # Phase 1: how to run, test, deploy, validate
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit-tasks — not created here)
```

### Source Code (repository root)

```text
src/
├── lib/
│   ├── domain/              # Pure. Imports no framework, no storage, no DOM.
│   │   ├── types.ts         # Lexeme, Token, WordState, HistoryEntry
│   │   ├── state.ts         # State set, legal transitions, the projection
│   │   ├── history.ts       # Append-only log; replay; device counter
│   │   ├── tiling.ts        # Token tiling invariants over a document
│   │   └── offsets.ts       # Code-point offsets; the one place counting happens
│   ├── analyzer/            # SEAM: language provider
│   │   ├── types.ts         # The Analyzer interface, async and fallible by design
│   │   └── character.ts     # Slice 0's placeholder: one token per character
│   ├── content/             # SEAM: content source
│   │   ├── types.ts         # The ContentSource interface
│   │   └── paste.ts         # Slice 0's only source
│   ├── storage/             # Adapter. The only module that talks to SQLite.
│   │   ├── migrations/
│   │   │   └── 001-initial.sql
│   │   ├── db.ts            # Open, migrate, OPFS wiring
│   │   └── repository.ts    # Typed operations over the domain types
│   ├── diagnostics/
│   │   └── log.ts           # On-device failure record (FR-021)
│   └── ui/                  # Shared presentational pieces
├── routes/
│   ├── +layout.svelte
│   ├── +page.svelte         # Library: list documents, paste a new one
│   └── read/[id]/+page.svelte  # Reader: tokens, tap to open the state menu
└── app.html

tests/
├── domain/                  # Test-first, per Principle II
│   ├── state.test.ts        # Transitions, property-based
│   ├── history.test.ts      # Replay reproduces current state
│   ├── tiling.test.ts       # Invariants only, never expected segmentations
│   └── offsets.test.ts      # Code points vs UTF-16 units, including astral chars
├── architecture/
│   └── domain-purity.test.ts # Principle V.4, enforced
└── storage/
    └── migration.test.ts    # The hedge columns exist and survive
```

**Structure Decision**: A single SvelteKit application, because there is no server to separate
from. The important boundary is not client/server but `src/lib/domain/` against everything else:
the domain is plain TypeScript with no imports from Svelte or SQLite, which is what let the entire
backend disappear in ADR-0007 without the data model moving. `src/lib/analyzer/` and
`src/lib/content/` are the two seams with instances in this slice; `src/lib/storage/` is the only
module permitted to know that SQLite exists.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| SQLite-WASM in OPFS, rather than IndexedDB, in a slice meant to be minimal | The schema is relational with an append-only log that must be folded to produce current state (FR-011). Export is a requirement soon (ADR-0007) and is a file copy with SQLite. Storage engine is not cheap to change once earned data exists, and slice 1's data is real. | IndexedDB with a thin wrapper is a simpler API and avoids a WebAssembly dependency, but makes joins and the replay fold manual code, and turns export into a bespoke serialisation format. Switching later would migrate earned data — the one category ADR-0003 says to decide up front. Recorded as ADR-0008. |
| Five schema elements with no visible slice-0 capability | Earned data and one-way doors: history, provenance, owner, device identity and counter, retained raw content. | Adding them later means fabricating history never recorded, or backfilling attribution by guess. This is Principle V's standing policy, and the spec states it under "Requirements Deliberately Included Before They Are Used". |

Neither entry is a principle violation in substance; both are recorded because a reader
encountering a WebAssembly database or five unused columns in a walking skeleton deserves to find
the reasoning rather than infer it.
