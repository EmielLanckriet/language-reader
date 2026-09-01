<!--
SYNC IMPACT REPORT
Version change: 1.3.0 → 1.4.0
Bump rationale: MINOR, and the judgement is worth stating. The Technology Stack
is replaced wholesale — the backend, database server and hosting platform are
removed — but no principle is removed or redefined incompatibly. Principle I
keeps its substance (a slice is not done until deployed and used on a phone) and
loses only the name of a specific host. Principle II's mandatory list is
unchanged; only its tooling moves language. Semantic versioning here governs the
constitution as a document, not the size of the engineering change. Recorded in
ADR-0007.

Modified principles:
  - I. Every Slice Ships To The Phone — no longer names Fly.io; requires the app
    be deployed to its host and installed on the phone.
  - II. Test-First On State Transitions — tooling moves from pytest/hypothesis to
    vitest and a property-based library, following the domain core to TypeScript.
    The mandatory list and the exemptions are unchanged.

Added sections: none
Removed sections: none

Rewritten:
  - Additional Constraints → Technology Stack. No server, no backend language, no
    database server, no hosting subscription. Browser storage, Intl.Segmenter,
    static hosting. Records the three preserved options (Pyodide, native wrapper,
    laptop-side import) as available rather than rejected.

Deferred items:
  - TODO(PROJECT_NAME): Working title "Language Reader" is in use throughout.
    Renaming is a PATCH-level amendment and requires no ADR.

Follow-up: none blocking.
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

- Word status transitions (`unknown` / `learning` / `known` / `ignored`) and their legal edges
- **Lexeme merge and split**, including status resolution
- **Status event replay** — that folding the event log reproduces current status
- Review scheduling logic
- Text segmentation correctness
- Anki export payload construction

Property-based tests MUST be used where the state space is large enough to make example-based
tests unconvincing. UI components, wiring, and glue code are explicitly EXEMPT.

Tooling follows the domain core's language: `vitest` as runner and a property-based library such
as `fast-check`. The mandatory list above and the exemptions are language-independent and are
unchanged by this.

**Derived data is tested for its invariants, never for exact values.** Segmentation output MUST
be asserted on properties — spans non-overlapping, spans covering the input exactly, offsets
valid, every token resolving to a lexeme, re-segmentation idempotent for a fixed analyzer
version — and MUST NOT be asserted against expected segmentations. Word-hood is undefined and
analyzer-dependent, so expected values encode one analyzer's judgment and break on every
upgrade. Earned data, by contrast, is asserted exactly.

**Properties proved in a verified kernel are not re-tested in Python** (see Principle VII and
ADR-0005). What is tested at that boundary is the adapter: that values are correctly marshalled
into and out of the kernel.

Rationale: These areas are the only parts of the system with real invariants; everywhere else,
tests would be ceremony that slows learning without buying correctness. Narrow, mandatory rigor
is sustainable. Universal TDD on a solo exploratory project is not. Merge and split are on this
list because ADR-0002's claim that word identity is revisable depends entirely on their
correctness, and because correcting segmentation — a user-facing feature — is implemented by
them.

### III. Anki Is Authoritative And Read-Mostly

The user's Anki collection is an external system under a one-way contract. This tool MUST NOT
mutate existing scheduling state, FSRS parameters, note types, cards, or review history. It MAY
propose new notes. Every write path MUST be additive and reversible.

Rationale: The collection holds years of irreplaceable review history. A scheduling corruption
is silent, discovered late, and unrecoverable. No feature is worth that risk, so the constraint
is absolute rather than case-by-case.

### IV. Vertical Slices Only

Every feature MUST span persistence, API, and UI. Horizontal phases ("build the backend first",
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
anticipated changes, not by intuition. Every feature specification MUST list the future
capabilities it can foresee, and each entry MUST be rated on two axes: how plausible the change
is, and what retrofitting it later would cost.

**Earned versus derived data.** Before applying the reversibility test, persisted data MUST be
classified. Data is EARNED if it results from the user's irreplaceable effort or from an external
system of record — word status, review history, notes, reading position, anything imported from
Anki — and cannot be reconstructed if lost. Data is DERIVED if it is computed from earned data,
source material, or reference data — segmentation, tokens, pronunciations, definitions,
frequency annotations — and can be recomputed.

Changes to the structure of EARNED data are expensive by default and MUST be hedged before the
first row is written. Changes to the structure of DERIVED data are cheap by default REGARDLESS
OF ROW COUNT, and MUST be deferred; recomputation is not migration.

This holds only while the inputs to derivation are retained. Any pipeline that discards its
input silently converts derived data into earned data. Inputs MUST therefore be preserved
verbatim, and discarding one is a decision requiring an ADR.

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

Every architectural choice MUST produce a short ADR in `docs/adr/` stating what was decided,
which alternatives were rejected, and why. ADRs are written during planning, never
retroactively.

Rationale: With open-ended scope these decisions will be revisited, often after the reasoning
has been forgotten. Unrecorded rationale is the most expensive artifact to lose, and it is the
cheapest to capture at the moment of choosing.

### VII. Readable Over Clever

Readability ranks above brevity and above cleverness. Where a shorter, more elegant, or more
idiomatic construction is harder to follow than a longer plain one, the plain one MUST be
chosen. Explicit over implicit; a named intermediate over a dense expression; a longer function
with a clear sequence over a short one requiring several inferences; comments that explain *why*
rather than restating *what*.

**Source versus artifact.** This principle governs code a human is expected to read and modify.
It does NOT govern generated artifacts, which are judged by whether their *source* is readable —
compiler output is not held to the standard of the language it was compiled from. An artifact
qualifies only if its source is in the repository and is what gets edited, generation is
reproducible by a committed command, it sits behind a hand-written interface, and it is never
hand-edited.

Dafny-generated Python qualifies. **Agent-generated Python does NOT** — it has no retained
editable source, its generation is not reproducible, and it is edited directly thereafter. It is
held to this principle in full.

Rationale: The developer is learning software engineering through this project rather than
arriving with it, so reading the code is a substantial part of the point rather than a
maintenance overhead. An unwritten preference of this kind gets traded away silently whenever
something else is locally convenient; written down, it can be argued against. See ADR-0004.

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
- **Verified kernels**: Dafny 4.11.0 installed as a `dotnet tool`, compiled with
  `dafny build -t:js`, requiring `bignumber.js`. Scope unchanged from ADR-0005 — small pure
  algebraic components only.
- **Toolchain versions** (verified working 2026-09-01): Node 24.20.0 LTS via `nvm`; .NET SDK
  10.0.400 LTS with the 8.0 runtime, user-local in `~/.dotnet`; spec-kit 1.0.3. All installed
  without `sudo` and without altering system packages.
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

The Spec Kit flow is followed in order: `specify` → `clarify` → `plan` → `tasks` → `implement`.

`clarify` is MANDATORY on every feature, not optional. Ambiguity is disproportionately expensive
for a solo developer without professional software engineering experience, because unresolved
ambiguity is resolved silently by the implementing agent rather than surfaced.

Every feature branch ends with a deploy and a phone check, per Principle I. ADRs are authored
during `plan`, per Principle VI.

**Anticipated Changes.** Every specification MUST contain an "Anticipated Changes" section
listing foreseeable future capabilities, each rated for plausibility and retrofit cost per
Principle V. `plan` MUST consult this section when justifying seams, and MUST NOT introduce a
seam that is not traceable to an entry in it. The union of these lists is maintained in
`docs/anticipated-changes.md`; ratings there are revised as the project learns, and a revision
that moves an item into the "build the seam now" cell is a trigger for planning work, not a
silent edit.

## Governance

This constitution supersedes ad-hoc practice. Where a plan, task, or implementation conflicts
with it, the constitution wins.

**Amendments** require an ADR in `docs/adr/` explaining the change and its motivation. Adding or
moving a seam under Principle V is an amendment.

**Versioning** follows semantic versioning:

- **MAJOR**: a principle is removed or redefined in a backward-incompatible way.
- **MINOR**: a principle or section is added, or guidance is materially expanded.
- **PATCH**: clarifications, wording, and non-semantic refinements.

**Compliance**: every `plan` MUST verify its approach against these principles before `tasks` is
generated. Complexity that violates Principle V MUST be justified in writing or removed. Review
gates that pass without checking Principle III are invalid.

**Version**: 1.4.0 | **Ratified**: 2026-08-28 | **Last Amended**: 2026-09-01
