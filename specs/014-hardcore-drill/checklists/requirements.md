# Specification Quality Checklist: Hardcore mode

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-10-12
**Feature**: [spec.md](../spec.md)

## Content Quality

- [x] No implementation details (languages, frameworks, APIs)
- [x] Focused on user value and business needs
- [x] Written for non-technical stakeholders
- [x] All mandatory sections completed

## Requirement Completeness

- [x] No [NEEDS CLARIFICATION] markers remain
- [x] Requirements are testable and unambiguous
- [x] Success criteria are measurable
- [x] Success criteria are technology-agnostic (no implementation details)
- [x] All acceptance scenarios are defined
- [x] Edge cases are identified
- [x] Scope is clearly bounded
- [x] Dependencies and assumptions identified

## Feature Readiness

- [x] All functional requirements have clear acceptance criteria
- [x] User scenarios cover primary flows
- [x] Feature meets measurable outcomes defined in Success Criteria
- [x] No implementation details leak into specification

## Notes

- Domain terms (FSRS stability, `evidence-4`, ADR references) are used as in specs 007–013: they
  name the reader's own concepts, not implementation choices.
- Clarified 2026-10-12 (6 answers in the spec): options per start, broad "not yet active",
  session recorded, sticky activation, fragment start chosen, drill grades in the FSRS fit.
  Again returning 3 cards later stays an unconfirmed default.
