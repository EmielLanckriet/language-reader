<!--
Amended 2026-10-31 (ADR-0046): the short path is the default; test-first and mutation checks only
for earned data; anticipated changes and ADRs only for earned data and revisited decisions; stale
Dafny, whisper and old-status text removed; one earned/derived definition; no versioning.
-->

# Language Reader Constitution

## Core Principles

### I. Every Slice Ships To The Phone

Every feature MUST be deployed to its host and exercised on a real Android phone, from the
installed app, before it is considered complete. Working on localhost is not "done". A feature
that has never run on the target device has not been validated. This principle names no specific
host: what it requires is that the thing you use is the thing you shipped.

Rationale: The primary risk on this project is accumulating architectural decisions that were
never tested against reality. The developer is solo and cannot evaluate an architecture by
inspection alone; the phone is the oracle. Shipping continuously converts unknowable design
questions into observable facts.

### II. Test-First On State Transitions (NON-NEGOTIABLE)

Tests MUST be written before implementation for the following, and only the following, areas:

- Word status transitions (`retired` / `active` / `ignored`, spec 019) and their legal edges
- **Lexeme merge and split**, including status resolution
- **Status event replay** — that folding the event log reproduces current status
- Review scheduling logic
- Text segmentation correctness
- Migrations, and any other code that writes or reshapes earned data

Property-based tests MUST be used where the state space is large enough to make example-based
tests unconvincing. UI components, wiring, glue code, derived data and sending to outside
services are explicitly EXEMPT: at most one test that would catch a plumbing bug. Mutation checks
("make the test fail before keeping it") belong to the list above, not to the exempt areas.

Tooling follows the domain core's language: `vitest` as runner and a property-based library such
as `fast-check`. The mandatory list above and the exemptions are language-independent and are
unchanged by this.

**Derived data is tested for its invariants, never for exact values.** Segmentation output MUST
be asserted on properties — spans non-overlapping, spans covering the input exactly, offsets
valid, every token resolving to a lexeme, re-segmentation idempotent for a fixed analyzer
version — and MUST NOT use an expected segmentation as a universal correctness invariant. Separate,
versioned quality benchmarks MAY compare against reviewed reference segmentations (ADR-0031). Word-hood is undefined and
analyzer-dependent, so expected values encode one analyzer's judgment and break on every
upgrade. Earned data, by contrast, is asserted exactly.

Rationale: These areas are the only parts of the system with real invariants; everywhere else,
tests would be ceremony that slows learning without buying correctness. Narrow, mandatory rigor
is sustainable. Universal TDD on a solo exploratory project is not. Merge and split are on this
list because ADR-0002's claim that word identity is revisable depends entirely on their
correctness, and because correcting segmentation — a user-facing feature — is implemented by
them.

### III. Anki Is Read, Never Written

The user's Anki collection is an external system under a one-way contract. This tool MUST NOT
mutate existing scheduling state, FSRS parameters, note types, cards, or review history. It MAY
propose new notes. Every write path MUST be additive and reversible.

Scheduling belongs to the Reader: reviews happen in the app, over the Reader's own history, and
Anki's scheduling state is a **seed** for it, read from a copy of the collection. After a word's
first review in the Reader, Anki no longer changes its schedule.

Rationale: The collection holds years of irreplaceable review history. A scheduling corruption
is silent, discovered late, and unrecoverable, so the constraint on writing is absolute. Moving
scheduling into the Reader (ADR-0026) lets reading and viewing shape it, which Anki cannot be
told; it does not relax the constraint on writing.

### IV. Vertical Slices Only

Every feature MUST span storage and UI. Horizontal phases ("build the backend first",
"do all the models now") are PROHIBITED. Each increment MUST be small enough to discard without
significant loss.

Rationale: Vertical slices keep Principle I achievable and bound the cost of a wrong
architectural choice to one slice rather than one layer. Discardability is the property that
makes exploration safe.

### V. Modular By Seam, Flat Within

Scope is deliberately open-ended, so seam placement matters more than it would on a bounded
project. Four seams are MANDATORY and are named here:

1. **Language providers** — Chinese and Dutch have fundamentally different NLP requirements
   (segmentation and pinyin versus lemmatization and compound splitting). Language-specific
   logic MUST sit behind one interface.
2. **Content sources** — pasted text, EPUB, subtitles, and video MUST each implement one
   ingestion interface.
3. **SRS export targets** — Anki is the only target today; the export boundary MUST NOT assume
   it is the only one.
4. **Domain core isolated from delivery mechanism** — code owning word state and scheduling MUST
   NOT import a web framework or an ORM.

WITHIN a module, no new abstraction layer may be introduced until a second concrete case demands
it. Speculative generality — an interface with one implementation outside the four seams above,
a plugin system with one plugin, configuration for values that never vary — is PROHIBITED. New
seams are added by amending this constitution, never improvised mid-feature.

**Anticipated change filter.** Seam placement is driven by an explicit register of
anticipated changes, not by intuition. A feature that adds or reshapes earned data MUST list the
future capabilities it can foresee, each rated on two axes: how plausible the change is, and what
retrofitting it later would cost. Other features MAY skip the register.

**Reversibility test.** The remaining cases resolve as follows, and a new seam requires BOTH
conditions:

| | Expensive to retrofit | Cheap to retrofit |
|---|---|---|
| **Likely** | Build the seam NOW | Defer; record it in the spec |
| **Unlikely** | Hedge the schema (see below) | Ignore entirely |

A change is EXPENSIVE to retrofit if deferring it would later require migrating populated
tables, changing a persisted identifier, or changing a contract an external system depends on. A
change is CHEAP to retrofit if deferring it would cost only a mechanical code refactor —
extracting an interface from a concrete implementation, moving a function, renaming a type.
Structural refactoring of code is cheap and getting cheaper; migration of accumulated data is
not. Uncertainty about which cell an item falls into MUST be resolved toward "cheap", because
the cost of a wrong abstraction exceeds the cost of a late one.

**Earned versus derived data.** Persistence alone does not make data expensive to change;
irreproducibility does. Every persisted field MUST be classified:

- **Earned** — produced by the user or an irreproducible external process, recoverable from
  nothing the system retains. Word status, review history, notes, reading position, imported
  collection data. The shape of earned data MUST be settled before it begins accumulating.
- **Derived** — computed from inputs the system preserves, and therefore discardable and
  rebuildable. Tokens, segmentation, pronunciation annotations, dictionary joins, computed
  statistics. Changing the shape of derived data is a recompute rather than a migration, and
  MUST be deferred.

Corollary: derived data is cheap to change only while its inputs are retained. Source inputs MUST
be preserved verbatim, and the parameters needed to reproduce a derivation — analyzer name and
version, model identifiers — MUST be recorded with the output. A derivation whose inputs were
discarded has silently become earned data and loses this exemption.

**Hedge the schema, not the code.** For changes that are unlikely but expensive to retrofit, the
correct response is NOT an abstraction. It is a data model that does not preclude the change —
an unused column, a surrogate identifier in place of a natural key, a nullable field reserved
for a later concept. Such hedges MUST be recorded in the anticipated-changes register with the
change they protect against. Hedges cost nothing at runtime and remove the migration; an
abstraction built for a case that never arrives costs comprehension forever.

Rationale: Modularity and over-engineering are different axes. Seams determine whether the
project can grow; layers determine whether it can be debugged. This principle authorizes
structure at named, justified boundaries and forbids it everywhere else, so that abstraction is
always a recorded decision rather than an accumulation.

### VI. Decisions Are Recorded

A short ADR in `docs/adr/` records what was decided, which alternatives were rejected, and why,
for decisions about the shape of earned data and for choices likely to be revisited. Smaller
changes to a recorded decision get a dated note on its ADR, not a new one.

Rationale: With open-ended scope these decisions will be revisited, often after the reasoning
has been forgotten. Unrecorded rationale is the most expensive artifact to lose, and it is the
cheapest to capture at the moment of choosing.

### VII. Readable Over Clever

Readability ranks above brevity and above cleverness. Where a shorter, more elegant, or more
idiomatic construction is harder to follow than a longer plain one, the plain one MUST be
chosen. Explicit over implicit; a named intermediate over a dense expression; a longer function
with a clear sequence over a short one requiring several inferences; comments that explain *why*
rather than restating *what*.

Rationale: The developer is learning software engineering through this project rather than
arriving with it, so reading the code is a substantial part of the point rather than a
maintenance overhead. An unwritten preference of this kind gets traded away silently whenever
something else is locally convenient; written down, it can be argued against. See ADR-0004.

### VIII. Fast First, Better In The Background

Every derived result MUST reach the reader fast enough to be hassle-free: usable within seconds
of asking, even if rough. A better result MAY then be computed incrementally in the background
while the reader already uses the rough one, replacing it piece by piece as each piece finishes.
The reader MUST NOT be made to wait for the best version when a rough one could be shown.

- A better piece MUST never be overwritten by a rougher one, and each piece MUST record which
  method produced it, so the upgrade can be resumed or redone.
- When a fast method and a slow good method compete, the answer is both, not a choice: the fast
  one at once, the slow one behind it.
- This applies to derived data only (ADR-0003). Earned data is never "rough" and is never
  replaced by a background process.

Instances: transcription shows a 10 s first window, then 30 s windows (ADR-0029); line
translation by a small dedicated model, replaced by Termux's better pass as it arrives (ADR-0023);
dictionary segmentation at once, the contextual model behind it.

Rationale: Stated by the reader on 2026-09-26, after the local LLM translated three times slower
than playback on the phone. A long up-front wait is the friction that made Sapling unusable, and
a result that arrives after the reader has given up is worth nothing, however good. Background
improvement keeps quality from being traded away for speed. See ADR-0023.

## Additional Constraints

**Technology Stack.** The following stack is fixed; deviation requires an ADR.

**There is no server.** No backend, no database server, no hosting subscription, and nothing that
requires a payment method or can lapse. This is a reliability requirement rather than a cost
optimisation: a design depending on a subscription its owner will not maintain is a design that
fails. See ADR-0007.

- **Application**: TypeScript and SvelteKit, built as an installable, offline-capable web app.
  Mobile-first. The domain core MUST NOT import framework or storage APIs (Principle V).
- **Storage**: browser storage on the device. The app MUST request persistent storage via
  `navigator.storage.persist()`, and MUST provide an export file early — browser storage is
  evictable by default, and reader data is earned and irreplaceable.
- **Hosting**: a free static host that requires no payment method. The repository holds code only;
  reader data never reaches it.
- **Chinese analysis**: `Intl.Segmenter` for segmentation, a JavaScript library for pronunciation,
  CC-CEDICT as a data file. The analyzer's output is never authoritative; user corrections are
  earned data anchored on character offsets (ADR-0002).
- **Toolchain versions** (verified working 2026-09-01): Node 24.20.0 LTS via `nvm`; spec-kit
  1.0.3. All installed without `sudo` and without altering system packages.
- **Anki integration**: `.apkg` export. The reader remains independent of `sentencegen`
  (ADR-0006).
- **LLM analysis** (optional tier): called directly from the browser with the reader's own key,
  pay-per-use, never a subscription. The app MUST remain fully functional without it.

**Preserved options, available rather than rejected** (ADR-0007). Taking any of these is additive
and needs no revisiting of the no-server decision:

1. **Pyodide** — jieba and pypinyin in the browser, if measurement shows `Intl.Segmenter` is
   materially worse on real reading material.
2. **A native wrapper** over the same codebase, if browser storage proves unreliable in practice.
3. **A laptop-side Python import tool**, producing a file the phone imports.

Every new dependency MUST carry a named justification, per Principle V.

## Development Workflow

**The short path is the default**: a clear problem, a focused change, and the checks that change
can plausibly break (ADR-0031). The full Spec Kit flow (`specify` → `clarify` → `plan` → `tasks`
→ `implement`) is for changes that add or reshape earned data, or change the architecture; within
it, `clarify` is mandatory, because ambiguity is otherwise resolved silently by the implementing
agent.

Changes reach the phone in batches, per Principle I. A change updates `docs/current-state.md` with
a line, and an ADR only per Principle VI.

**Anticipated Changes.** A specification that adds or reshapes earned data contains an
"Anticipated Changes" section rated per Principle V; `plan` MUST NOT introduce a seam that is not
traceable to an entry in it. `docs/anticipated-changes.md` collects them and is read when placing
a seam, not by default.

## Governance

This constitution supersedes ad-hoc practice. Amending it takes a short ADR. Adding or moving a
seam under Principle V is an amendment.

**Last Amended**: 2026-10-31 (ADR-0046)
