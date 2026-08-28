<!--
SYNC IMPACT REPORT
Version change: (none) → 1.0.0
Bump rationale: Initial ratification. No prior constitution existed; all template
placeholders replaced with concrete project governance.

Modified principles: none (initial adoption)

Added sections:
  - Core Principles I–VI (Every Slice Ships To The Phone; Test-First On State
    Transitions; Anki Is Authoritative And Read-Mostly; Vertical Slices Only;
    Modular By Seam, Flat Within; Decisions Are Recorded)
  - Additional Constraints (Technology Stack)
  - Development Workflow
  - Governance

Removed sections: none

Template placeholders resolved: PROJECT_NAME, PRINCIPLE_1..5_NAME/DESCRIPTION
  (extended to 6 principles), SECTION_2_NAME/CONTENT, SECTION_3_NAME/CONTENT,
  GOVERNANCE_RULES, CONSTITUTION_VERSION, RATIFICATION_DATE, LAST_AMENDED_DATE

Deferred items:
  - TODO(PROJECT_NAME): Working title "Language Reader" is in use throughout.
    The final product name has not been chosen. Renaming is a PATCH-level
    amendment and requires no ADR.

Follow-up: none blocking.
-->

# Language Reader Constitution

## Core Principles

### I. Every Slice Ships To The Phone

Every feature MUST be deployed to Fly.io and exercised on a real Android phone before it is
considered complete. Working on localhost is not "done". A feature that has never run on the
target device has not been validated.

Rationale: The primary risk on this project is accumulating architectural decisions that were
never tested against reality. The developer is solo and cannot evaluate an architecture by
inspection alone; the phone is the oracle. Shipping continuously converts unknowable design
questions into observable facts.

### II. Test-First On State Transitions (NON-NEGOTIABLE)

Tests MUST be written before implementation for the following, and only the following, areas:

- Word status transitions (`unknown` / `learning` / `known` / `ignored`) and their legal edges
- Review scheduling logic
- Text segmentation correctness
- Anki export payload construction

Property-based tests MUST be used where the state space is large enough to make example-based
tests unconvincing. UI components, wiring, and glue code are explicitly EXEMPT.

Rationale: These four areas are the only parts of the system with real invariants; everywhere
else, tests would be ceremony that slows learning without buying correctness. Narrow, mandatory
rigor is sustainable. Universal TDD on a solo exploratory project is not.

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

## Additional Constraints

**Technology Stack.** The following stack is fixed; deviation requires an ADR.

- **Backend**: Python 3, FastAPI, SQLite on a persistent Fly.io volume.
- **Chinese NLP**: jieba or pkuseg for segmentation, pypinyin for pinyin, CC-CEDICT for
  dictionary data.
- **Dutch NLP**: spaCy `nl_core_news_sm`.
- **Frontend**: SvelteKit, delivered as an installable PWA. Mobile-first. Reading MUST work
  offline.
- **Deployment**: Fly.io with a persistent volume. The project MUST be containerized from the
  first commit.
- **Anki integration**: `.apkg` export via genanki for v1. A sync client built on the official
  `anki` Python library is the intended successor path and MUST remain reachable from the
  export seam in Principle V.

Every new dependency MUST carry a named justification, per Principle V.

## Development Workflow

The Spec Kit flow is followed in order: `specify` → `clarify` → `plan` → `tasks` → `implement`.

`clarify` is MANDATORY on every feature, not optional. Ambiguity is disproportionately expensive
for a solo developer without professional software engineering experience, because unresolved
ambiguity is resolved silently by the implementing agent rather than surfaced.

Every feature branch ends with a deploy and a phone check, per Principle I. ADRs are authored
during `plan`, per Principle VI.

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

**Version**: 1.0.0 | **Ratified**: 2026-08-28 | **Last Amended**: 2026-08-28
