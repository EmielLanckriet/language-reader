# Implementation Plan: Real Segmentation, Measured (Slice 2)

**Branch**: `003-real-segmentation` | **Date**: 2026-09-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/003-real-segmentation/spec.md`

## Summary

Replace slice 0's character-per-token placeholder with `Intl.Segmenter`, re-derive every existing
document from its retained source, and answer — from measured evidence on the reader's own material —
whether a heavier segmenter is worth its download.

The approach is settled by five measurements taken during Phase 0 rather than by argument:

1. `Intl.Segmenter` is **correct on ordinary text and characteristically wrong on compounds and
   names** (自行车 → 自行 / 车). Good enough to ship, not good enough to be the end state.
2. Its offsets are **UTF-16 code units**, and this codebase is code points throughout. The adapter's
   conversion is the highest-risk line of code in the slice, because getting it wrong mis-anchors
   **earned** data.
3. It **cannot be versioned by its host**, so its version is a fingerprint of its own behaviour
   ([ADR-0011](../../docs/adr/0011-analyzer-version-as-behaviour-fingerprint.md)). This makes ICU
   drift self-healing through the re-derivation path the slice already builds.
4. Segmentation costs **3.8 ms per 5,000 code points** — a thousandth of the budget — so performance
   shapes nothing, and unit-at-a-time segmentation is free.
5. Every alternative candidate costs **2.5× to 10× slice 1's 1.40 MB install**, so the comparison
   runs laptop-side and only the winner ships
   ([ADR-0012](../../docs/adr/0012-candidate-comparison-runs-laptop-side.md)).

## Technical Context

**Language/Version**: TypeScript 5.x on Node 24.20.0 (`.nvmrc`), SvelteKit 2 / Svelte 5

**Primary Dependencies**: none added. `Intl.Segmenter` is a platform API. The comparison script uses
only Node built-ins plus whatever a candidate needs, and never enters the application bundle.

**Storage**: unchanged — SQLite WASM in OPFS behind the slice 1 storage worker and lease. One
migration adds no earned columns; token rows are rewritten, which is a recompute, not a migration.

**Testing**: `vitest`, with `fast-check` for the property obligations (tiling, offset validity,
determinism, idempotence). Per Constitution Principle II, segmentation is asserted on **properties
only** — never against expected segmentations, since word-hood is analyzer-dependent.

**Target Platform**: installed PWA, Chrome on Android; laptop Chrome for development

**Project Type**: single browser application, no server (ADR-0007)

**Performance Goals**: a 5,000-code-point document opens with real words within 3 s on the phone
(`SC-004`). Segmentation itself is measured at 3.8 ms, so the budget belongs to storage and render.

**Constraints**: fully offline (`FR-011`); install size not materially above slice 1's measured
1.40 MB (`FR-034`, `SC-008`); the catch-up sweep must never delay the reader (`FR-018`) and must not
run without the storage lease (`FR-019`).

**Scale/Scope**: one reader, one device, one language. Documents capped at 5,000 characters; a
library of tens of documents, not thousands.

## Constitution Check

*GATE: evaluated before Phase 0, re-evaluated after Phase 1. Both passes recorded.*

| Principle | Gate | Verdict |
|---|---|---|
| **I. Every slice ships to the phone** | Deploy and phone-check before done | **Pass** — `SC-009`. The phone check additionally records the device's segmenter fingerprint (ADR-0011), which is the one fact no laptop measurement can supply. |
| **II. Test-first on state transitions** | Segmentation correctness is on the mandatory list; properties, not examples | **Pass** — properties written before the analyzer: tiling over the whole document, offsets valid and code-point based, determinism for a fixed fingerprint, idempotence, astral-plane conversion. R1's example table is *research evidence*, not test data, and does not enter the suite. |
| **III. Anki authoritative** | No collection writes | **Pass** — not touched. |
| **IV. Vertical slices only** | Spans persistence, domain, UI; discardable | **Pass** — analyzer (domain), re-derivation (persistence), visible word boundaries (UI). Discarding it costs the analyzer swap and nothing earned. |
| **V. Modular by seam, flat within** | No new seams; structure traceable to the register | **Pass** — no new seam. The language-provider seam (seam 1) gains its third implementation and takes ownership of the delimiter set ([ADR-0013](../../docs/adr/0013-segmentation-unit-owned-by-language-provider.md)), which is a fact moving to where it belongs, not a new boundary. No abstraction is introduced for the candidates: they live in a script, not behind an interface. |
| **VI. Decisions are recorded** | ADRs authored during planning | **Pass** — ADR-0011, ADR-0012, ADR-0013 written here, before tasks. |
| **VII. Readable over clever** | Plain over short | **Pass, with one flagged risk** — the UTF-16→code-point conversion is where a clever one-liner is tempting and a named, tested helper is correct. |

**Earned versus derived audit** (Principle V, ADR-0003):

- Tokens: **derived**. Rewritten wholesale. No migration.
- `raw_content`: **earned**, and untouched — the premise of the whole re-derivation story (`FR-014`).
- `status_event`, `word_state`: **earned**, and untouched (`FR-023`–`FR-025`). The only way this
  slice could damage them is through the offset conversion in R2, which is why that is tested first.
- Analyzer fingerprint: **derived**, recomputed at every startup.

**No entries in Complexity Tracking.** Nothing in this plan requires a justified violation.

## Project Structure

### Documentation (this feature)

```text
specs/003-real-segmentation/
├── plan.md              # This file
├── spec.md
├── research.md          # Phase 0 — five measurements
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   ├── analyzer.md          # seam 1, revised for slice 2
│   └── re-derivation.md     # the two paths and what they promise
├── checklists/
│   └── requirements.md
└── tasks.md             # /speckit-tasks — not created here
```

### Source Code (repository root)

```text
src/lib/
├── analyzer/
│   ├── types.ts             # interface gains `unitDelimiters`
│   ├── character.ts         # slice 0 placeholder — RETAINED, see below
│   ├── chinese.ts           # NEW — Intl.Segmenter behind seam 1
│   ├── fingerprint.ts       # NEW — probe string, hashing, version derivation
│   ├── units.ts             # NEW — split into segmentation units, language-supplied delimiters
│   ├── active.ts            # NEW — the one place the active analyzer is named (see below)
│   └── resolve.ts           # unchanged
├── domain/
│   └── offsets.ts           # UTF-16 ↔ code point conversion lives here
├── storage/
│   ├── rederive.ts          # NEW — one document, one transaction; shared by both paths
│   ├── sweep.ts             # NEW — catch-up, lease-aware, yields to the reader
│   └── repository.ts        # token rewrite; no schema change to earned tables
└── ui/
    └── (word boundary rendering in the existing reader route)

scripts/
└── compare-segmenters/      # NEW — laptop-side only, never bundled (ADR-0012)

tests/                       # flat by area, matching the existing layout
├── domain/offsets.test.ts   # EXTENDED — UTF-16 index → code-point index
├── analyzer/                # NEW — contract properties, units, fingerprint
└── storage/                 # EXTENDED — re-derivation across an analyzer change
```

**Structure Decision**: the existing single-project layout is kept unchanged. Everything new is a
file inside an existing directory, except `scripts/compare-segmenters/`, which is deliberately
outside `src/` so that no bundler path can pull a candidate's data into the application.

**Two things the codebase already provides, confirmed by reading it rather than assuming.**
`src/lib/domain/tiling.ts` exports `checkTiling` and `tiles` — a reusable analyzer-agnostic check
built in slice 0, with its own tests including one asserting ends are measured in characters rather
than UTF-16 code units. Slice 2 **reuses** it against the new analyzer; it does not write a new
tiling check. And `offsets.ts` already has `codePointsOf`, `codePointLength` and `sliceByCodePoints`,
but **no UTF-16-index-to-code-point-index conversion** — that helper is genuinely new and is the one
R2 requires.

**The active analyzer needs a single home.** Today `characterSplitter` is imported and used directly
in `src/routes/+page.svelte`, which is fine when one analyzer exists and one path uses it. Slice 2
has two callers — import and re-derivation — that must agree on which analyzer is active, and a
disagreement between them would stamp documents wrongly. `active.ts` removes a duplicated choice; it
is not a registry, a plugin system, or a seam.

**`character.ts` is retained, not deleted.** It is the second implementation that makes seam 1 a
demonstrated seam rather than an asserted one, and the re-derivation tests need two analyzers to
switch between. It stops being the default; it does not stop existing.

## Phase Sequencing And Its Reasoning

Ordered so that the thing most likely to be wrong is discovered first — the rule slice 1's plan
followed, and the reason its lease bug surfaced with room to fall back.

1. **Offset conversion and its properties, before any analyzer.** R2 is the only defect in this slice
   that could corrupt earned data, and it is invisible in any text made of BMP characters. Written as
   a failing property test first.
2. **The fingerprint.** Cheap, and everything downstream stamps documents with it.
3. **The Chinese analyzer** behind seam 1, with units and delimiters.
4. **Re-derivation on open** — one document, one transaction, the simpler of the two paths.
5. **The catch-up sweep**, reusing exactly the same per-document function, so `FR-017`'s "two paths
   must agree" is true by construction rather than by testing two implementations against each other.
6. **Visible word boundaries** in the reader.
7. **The comparison script and the written conclusion.**
8. **Deploy and phone check**, recording the device fingerprint.

Steps 1–3 are where the risk is. Steps 4–6 are the visible slice. Step 7 is what makes the slice
finished rather than merely working.

## Constitution Re-Check (post-Phase 1)

Re-evaluated after `data-model.md`, both contracts and `quickstart.md` were written. **All gates
still pass.** Three things changed during design and are recorded here rather than silently:

**Principle II got stricter, not looser.** Phase 0 produced a table of example segmentations (R1),
and examples are exactly what this principle forbids in tests for derived data. The design keeps them
as *research evidence* and states in `quickstart.md` that any test asserting 中国 is one token must be
deleted. The properties replacing them are listed in `data-model.md` §Validation Rules. The one place
exact assertion is required — earned rows unchanged across re-derivation — is called out as exact,
because that is earned data and the principle distinguishes the two.

**Principle V was tested by a temptation and held.** The obvious design for "compare several
candidates" is to make each candidate implement `Analyzer`. That would be an interface with several
implementations, which sounds like the seam working — but the candidates are not shipping, so it is
an abstraction built for implementations that do not exist. `contracts/analyzer.md` records the
refusal explicitly, and the candidates live in `scripts/`, outside `src/`.

**Principle IV was checked against a real risk of growth.** Re-derivation's second path (the sweep)
was added by clarification and could have justified a queue table, a progress row, and a scheduler.
The design has none: staleness is derived by comparing a document's stamp to the active analyzer's,
so there is no second source of truth to disagree with reality, and both paths call one function.
The slice stays discardable.

**No Complexity Tracking entries.** Nothing here requires a justified violation.

### One design decision worth flagging to `/speckit-tasks`

The install-size budget (`FR-034`, `SC-008`) is enforced by extending `scripts/check-bundle.mjs`,
which already runs in `postbuild` and already fails the build on a bundle regression. That makes the
budget a build gate rather than a remembered intention — consistent with how slice 1 handled the
duplicate-SQLite problem, and with the standing rule on this project that a check written down beats
a fact remembered.
