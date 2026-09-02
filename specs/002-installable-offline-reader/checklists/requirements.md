# Specification Quality Checklist: Installable, Offline, and Safe From Silent Loss (Slice 1)

**Purpose**: Validate specification completeness and quality before proceeding to planning
**Created**: 2026-09-02
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

Passed on the second iteration. The first draft failed "no implementation details" in one place and
it is worth recording why, because the same pressure will recur.

**The mechanisms are conspicuously absent, and that is deliberate.** This slice originates in three
concrete technical problems — a missing manifest, a missing service worker, an exclusive storage
lease — and the input describing it named all three along with candidate solutions. None of those
names appear in the mandatory sections. What appears instead is what the reader experiences: the
icon opens in the browser, the application needs a network, a second copy discards work. This
matters more than usual here because **the obvious mechanism is not the only one**: "it opens in
its own window" can be satisfied in more than one way, and writing the manifest into the
requirements would have decided the plan by accident.

Three qualifications, recorded rather than glossed:

1. **FR-002 is aware of a deployment fact without stating it.** "It MUST NOT matter what path the
   application is served from" exists because an installed application that launches to the wrong
   path shows a missing page, which was observed. Phrased as an outcome the reader can see, but a
   non-technical reader would not know why it needed saying.

2. **The Assumptions section originally named the storage engine** while explaining why the
   application's size is a real question. Rewritten to "the machinery that stores and queries the
   reader's data", which carries the same weight without deciding anything. This was the one
   genuine failure in the first draft.

3. **FR-013 and FR-018 contain the softest language in the spec** — "the most likely reason", "once
   and discoverably rather than repeatedly". Both resist tightening without prescribing an
   interface. They are testable in the sense that matters: a reader shown neither would notice.

**Two decisions were made here rather than deferred**, both of which the input explicitly asked the
spec to settle:

- **Provisional marks, permanent documents.** Slice 0 declared its data disposable because marks
  attach to single characters, and said the exemption expired when slice 1 shipped — written
  assuming slice 1 replaced the segmenter. It does not. Rather than let the exemption lapse by
  accident or extend it silently, the spec splits the question: retained source content is earned
  from now on, marks on single-character words stay provisional, and FR-018 requires telling the
  reader. Recording the decision mattered more than which way it went.
- **A disabled control must explain itself (FR-017).** Inherited from slice 0, where the save
  control is disabled for empty input, making its rejection message unreachable. Resolved as:
  preventing the error is fine, leaving the reader to guess is not.

**Outstanding — worth probing during planning:**

- **Whether the application is small enough to keep on the device in full.** Recorded as an
  assumption. It is the one that could force a different shape if it turns out to be false, and it
  is measurable before any code is written.
- **How a copy learns that storage has become reachable again (FR-015).** The spec requires the
  reader be able to retry; whether that is a button, automatic, or both is a design question with a
  real difference in feel.
