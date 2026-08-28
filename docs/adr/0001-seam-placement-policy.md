# ADR-0001: Seam Placement Policy

**Status**: Accepted
**Date**: 2026-08-28
**Relates to**: Constitution Principle V (amended v1.0.0 → v1.1.0)

## Context

The project starts with deliberately open scope. It is expected to grow well beyond its first
feature set, and the developer's stated priority is that the system remain easy to change.

The initial constitution (v1.0.0) resolved this with a YAGNI-style rule: four named seams, and
within a module no new abstraction until a second concrete case demands it. That rule was
challenged on a reasonable ground — if a feature is hard to abstract after the fact, deferring
does not save effort, it forfeits the option. The counter-proposal was to enumerate anticipated
future features per specification and use that list to decide seam placement up front.

Two things were unresolved:

1. Whether anticipating future features is a sound basis for structural decisions, given the
   well-known unreliability of such predictions.
2. What to do with changes that are unlikely but would be painful to retrofit — a cell that
   neither YAGNI nor design-up-front handles well.

## Decision

Seam placement is governed by two filters, and a new seam requires **both**.

**Filter 1 — Anticipated change.** Every specification carries an "Anticipated Changes" section.
Structural decisions must trace to an entry in it. Seams may not be introduced for changes
nobody has written down.

**Filter 2 — Reversibility.** Each entry is rated for retrofit cost. A change is EXPENSIVE if
deferring it would later require migrating populated tables, changing a persisted identifier, or
changing a contract an external system depends on. It is CHEAP if deferring it would cost only a
mechanical code refactor. Ambiguous cases resolve to CHEAP.

The two filters combine as:

| | Expensive to retrofit | Cheap to retrofit |
|---|---|---|
| **Likely** | Build the seam now | Defer; record in spec |
| **Unlikely** | Hedge the schema | Ignore |

**Schema hedging.** For unlikely-but-expensive changes, the response is a permissive data model
rather than an abstraction: an unused column, a surrogate identifier in place of a natural key,
a nullable field reserved for a later concept. Hedges are recorded against the change they
protect.

The four seams already named in Principle V are retained and are re-justified under this policy:
language providers (two real cases: Chinese and Dutch), content sources (several stated cases),
domain core isolated from delivery mechanism (a dependency rule, not an abstraction, and
therefore free), and SRS export targets (one case only, retained because it is a function
boundary rather than a type hierarchy and its cost is negligible).

## Alternatives Rejected

**Pure YAGNI — defer all abstraction until a second case appears.** Rejected because it treats
all retrofit costs as equal. It is approximately correct for code structure, where extracting an
interface is mechanical, and clearly wrong for schema, where a migration on populated tables is
expensive and risky. The original v1.0.0 formulation had this flaw.

**Design up front from the anticipated feature list alone.** Rejected because an unfiltered list
of future features justifies unbounded structure, and because an abstraction derived from a
single example encodes that example's incidental properties as though they were essential. When
the second case arrives it is bent to fit, producing an abstraction that serves neither, at a
removal cost equal to what building it would have been. Prediction quality is the binding
constraint, and no filter for it was proposed.

**Abstract wherever uncertainty exists, on the reasoning that optionality is always worth
buying.** Rejected because it inverts the option's economics: an abstraction with one
implementation is an option that was paid for and will not be exercised, and its ongoing cost is
comprehension, which is the scarcest resource for a solo developer without professional software
engineering experience.

**No policy; decide case by case.** Rejected because the developer cannot yet evaluate
architectural proposals by inspection, and case-by-case judgment in that position resolves
toward whatever an implementing agent proposes. A written rule is checkable; taste is not.

## Consequences

**Easier.** Seam decisions become arguable from a written register rather than from intuition,
which is what makes them reviewable by someone still building architectural judgment. The
schema-hedge move gives a cheap answer to the hardest cell, where previously there was none.
Every seam becomes traceable to a specific anticipated change, so an obsolete seam can be
identified and removed when its motivating change is abandoned — designing for contraction, not
only extension.

**Harder.** Specifications now carry an additional required section, and `plan` must justify
seams against it. The register must be maintained honestly; if plausibility ratings are inflated
to license structure the policy degrades into design-up-front, which is the failure mode it
exists to prevent.

**Revisit if.** The anticipated-changes register turns out to have poor predictive accuracy over
several features — that is, seams are repeatedly built for changes that never arrive, or the
changes that do arrive were never listed. In that case Filter 1 is not earning its cost and the
policy should fall back toward reversibility alone.

## Notes on Prior Art

The anticipated-change filter is Parnas's decomposition criterion — module boundaries placed
around design decisions expected to change — from *On the Criteria To Be Used in Decomposing
Systems into Modules* (CACM, 1972), extended in *Designing Software for Ease of Extension and
Contraction* (IEEE TSE, 1979), which argues for designing for a program *family* and stresses
contraction as well as extension.

The reversibility filter is a real-options framing, following Baldwin and Clark, *Design Rules:
The Power of Modularity* (MIT Press, 2000): a module boundary is an option whose value rises
with genuine uncertainty and with the cost of the alternative, and falls with the cost of
creating it.

The rejection of premature generalization follows the practitioner argument that a wrong
abstraction is more costly than duplication, most associated with Sandi Metz.

These positions are argued from principle and experience. There is no strong empirical evidence
establishing how accurately designers predict change, and this policy should be understood as
engineering judgment with a theoretical frame rather than a settled result — which is why the
"Revisit if" condition above is stated in terms of observed predictive accuracy on this project.

Parnas and Clements, *A Rational Design Process: How and Why to Fake It* (IEEE TSE, 1986), is
relevant context for the surrounding Spec Kit workflow: the idealized process is unattainable,
and documenting as though it had been followed is nonetheless worthwhile.
