# Specification Quality Checklist: Real Segmentation, Measured (Slice 2)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-02
**Feature**: [spec.md](../spec.md)

## Content Quality

- [X] No implementation details (languages, frameworks, APIs)
- [X] Focused on user value and business needs
- [X] Written for non-technical stakeholders
- [X] All mandatory sections completed

## Requirement Completeness

- [X] No [NEEDS CLARIFICATION] markers remain
- [X] Requirements are testable and unambiguous
- [X] Success criteria are measurable
- [X] Success criteria are technology-agnostic (no implementation details)
- [X] All acceptance scenarios are defined
- [X] Edge cases are identified
- [X] Scope is clearly bounded
- [X] Dependencies and assumptions identified

## Feature Readiness

- [X] All functional requirements have clear acceptance criteria
- [X] User scenarios cover primary flows
- [X] Feature meets measurable outcomes defined in Success Criteria
- [X] No implementation details leak into specification

## Constitution Compliance

Checked against `.specify/memory/constitution.md` v1.4.0, because this project's gates are stricter
than the generic checklist above.

- [X] **Principle I** — a deploy and phone check is a success criterion (SC-008), not an afterthought
- [X] **Principle II** — the spec states that segmentation is asserted on properties and never
      against expected segmentations, and that earned data is asserted exactly (Assumptions)
- [X] **Principle III** — no Anki write path in this slice; nothing touches the collection
- [X] **Principle IV** — one vertical capability, spanning persistence (re-derivation), domain
      (segmentation) and UI (visible boundaries, markable words); small enough to discard
- [X] **Principle V** — the Anticipated Changes table exists, every entry is rated on both axes, and
      no new seam is introduced; the language-provider seam is exercised, not extended
- [X] **Principle VI** — no ADR is authored here; ADRs belong to `/speckit-plan`
- [X] **Principle VII** — not applicable to a specification

## Validation Notes

Re-validated 2026-09-02 after clarification. **23/23 → 23/23 items passing**; no item changed state
in either direction, and the clarifications strengthened several rather than altering pass/fail.

Five clarification questions were asked and answered, plus one follow-up correction from the reader.
Their effect on this checklist:

- *Requirements are testable and unambiguous* — strengthened. "Re-derived" now names when and by
  which of two paths; the segmentation unit and its delimiter rule are stated; the reference-data
  budget and the quality figure are both defined as recorded evidence plus a written justification
  rather than as unstated or invented limits.
- *Success criteria are measurable* — strengthened by removing a number. SC-001 no longer asserts a
  90% threshold, which had been chosen before any measurement existed. What is now gated (SC-002) is
  that the shipped analyzer is the best candidate actually measured, or carries a written reason for
  not being, and that the figure is recorded as a baseline.
- *No implementation details* — still passing. Named technologies appear only in the Anticipated
  Changes table and Dependencies, which is where this project's constitution requires them.

**D1 (vocabulary overlay) is settled**: out of this slice, because the reader's word list currently
holds placeholder-era single characters and an overlay would use them to split real words apart.

**D2 (LLM-as-joint-analyzer ordering) was deliberately not asked.** It orders a future register
entry rather than anything this slice builds, and the spec routes the evidence it needs to the
measurement in User Story 3. It is recorded as deferred rather than as outstanding.

**One item for `/speckit-plan`, unchanged by clarification**: FR-028 asks for short lines and long
prose to be reported separately, but no content source in this slice produces genuinely short lines
— they arrive as pasted text. Whether pasted subtitle text is a faithful stand-in for imported
subtitles with timing is a planning question, not a specification one.

## Amendment 2026-09-02, during `/speckit-tasks`

**FR-025 was rescoped, and the checklist still passes 23/23.** Generating tasks exposed that the
requirement demanded marks stay "visible in the word list" when **no word list exists** — nothing in
any shipped slice displays the reader's vocabulary. The tell was mechanical: it was the only
implementation task that could not be given a file path.

The requirement is now scoped to storage — the mark is not deleted, altered, or made unreachable,
and stays retrievable under the same word identity — which is what it was really protecting. A
screen showing the reader's vocabulary is registered under Anticipated Changes as a deferred item
alongside `reading_session`.

This strengthens *Requirements are testable and unambiguous*: FR-025 was previously untestable,
because there was no surface on which to observe it.

## Notes

- Items marked incomplete require spec updates before `/speckit-clarify` or `/speckit-plan`
