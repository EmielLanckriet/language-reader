# Specification Quality Checklist: Reader Walking Skeleton (Slice 0)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-08-31
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

Passed on the first iteration. Three qualifications, recorded rather than glossed:

1. **Named tools appear in two non-mandatory sections.** Anticipated Changes names pkuseg and
   Dafny; Dependencies names Fly.io. This is deliberate. Constitution Principle V requires
   structural decisions to trace to `docs/anticipated-changes.md`, and that traceability is
   worthless without naming what replaces what. The mandatory sections — User Scenarios,
   Requirements, Success Criteria — are free of stack references, which is where the rule is
   doing real work.

2. **FR-008, FR-009 and FR-014 are close to the line on "non-technical stakeholders".** They
   concern identity representation and offset anchoring, which are inherently structural. They are
   stated in terms of what must remain possible rather than how to store it, which is the most
   plain-language form available without losing the requirement. Their justification is
   consolidated under "Requirements Deliberately Included Before They Are Used" so a reader
   encountering them knows why a walking skeleton carries them.

3. **Five requirements support no visible capability in this slice.** Ordinarily that would fail
   "focused on user value". It is correct here: FR-010 through FR-014 concern earned data and
   one-way doors, and omitting them means later fabricating history that was never recorded. The
   spec states this explicitly rather than leaving it to be discovered during planning.

## Re-validated After Clarification — 2026-09-01

16/16 → 16/16 passing. No item changed state. The three qualifications above still hold, and
qualification 3 now covers more requirements: FR-010a, FR-010b and FR-010c also support no visible
slice-0 capability, for the same earned-data reason.

Five clarifications were integrated: access credential (FR-019), document size limit (FR-020),
tap-opens-a-menu (FR-006), failure visibility (FR-021, FR-022, SC-009), and dual timestamps on
history (FR-010, FR-010c). One raised a consequence beyond its own question — that state may
later be computed from signals the reader does not supply — producing FR-010a's
observations-not-conclusions rule.

**Outstanding — assumptions still unprobed**, deferred because the five-question quota went to
higher-impact items. None blocks planning; each is recorded in Assumptions and is cheap to revise:

- Punctuation, digits, whitespace and Latin text are tokens for tiling purposes but not markable.
  Low risk: reversible, and it only widens what can be marked.
- Character offsets are Unicode code points counted identically on both sides. **The highest-risk
  outstanding item** — the two runtime environments disagree by default, and a mismatch corrupts
  every stored position silently. Mitigated by being asserted in tests rather than assumed, but it
  deserves attention during planning.
- Whether discrete states are the right starting shape at all, given comparable tools use graded
  familiarity levels. Now largely defused: FR-006a makes the set extensible and FR-010a makes
  current state a projection, so a move to graded levels is a change of projection rather than of
  schema.
