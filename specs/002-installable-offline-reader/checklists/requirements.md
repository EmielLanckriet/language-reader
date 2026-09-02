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

## Re-validated After Clarification — 2026-09-02

16/16 → 16/16 passing. No item changed state, and no new implementation detail entered the
mandatory sections — checked explicitly, because four of the five answers were about *mechanism*
and the pull towards naming one was strong.

Five clarifications integrated, adding FR-003a, FR-003b, FR-015a and rewriting FR-010, FR-013,
FR-015 and FR-018. Two are worth noting beyond their own answers:

- **The version-update answer is staged, not final.** An explicit control now because deployments
  are frequent and knowing when one landed is diagnostic; automatic adoption later. Recorded under
  Anticipated Changes so it is a scheduled change rather than a decision that quietly ossifies.
- **The install offer doubles as a test.** A device only reports the application as installable
  once it genuinely qualifies, so FR-003b turns the offer's absence into a defect rather than a
  browser preference. This is exactly the check slice 0 lacked: nothing qualified, and nothing said
  so — which is why the icon opened a browser and no one knew until it was tapped.

One earlier outstanding item is now closed: how a copy recovers from read-only was resolved as
checking on the reader's next attempt plus an on-demand control, with FR-015a explicitly forbidding
background polling.

**Outstanding — worth probing during planning:**

- **Whether the application is small enough to keep on the device in full.** Recorded as an
  assumption. It is the one that could force a different shape if it turns out to be false, and it
  is measurable before any code is written.
- ~~How a copy learns that storage has become reachable again (FR-015).~~ **Resolved** by
  clarification: on the reader's next attempt, plus an on-demand control, and never by polling.

## Re-validated After Analysis — 2026-09-02

16/16 → 16/16. No item changed state, but one came closer to failing than the count suggests and
the reason is worth recording.

**"All functional requirements have clear acceptance criteria" passed on a requirement that could
not be met.** FR-014 required that saved content stay readable in the read-only state. It was
clear, testable, and unambiguous — and impossible, because the machinery that stores the reader's
data gives a copy without access no access for reading either. The checklist asks whether a
requirement is *well formed*, not whether it is *achievable*, and nothing in this list would ever
have caught it. It was caught in analysis, by comparing the spec against the design chosen to
implement it.

FR-014 is now amended to state what the design actually guarantees: the copy in front of the reader
is the one that reaches storage, and a copy that cannot reach it says so **in place of** the
library rather than showing an empty one. The amendment is marked inline in the spec, and the
original wording is quoted there, because a requirement that changed after a design decision should
show that it did.

Two consequences elsewhere:

- **US3's scenario 3, its independent test, and one edge case** were rewritten to match, and a new
  edge case added for two simultaneously visible copies — the case FR-014 now admits it cannot
  furnish.
- **The Anticipated Changes entries are now rated on plausibility and retrofit cost**, which
  Constitution Principle V requires of every specification and which this one had omitted entirely.
  The ratings are not decoration: the version-update entry is deferred *because* it rates cheap,
  and an equally certain but expensive change would have had to be built now.

**Nothing outstanding.** The assumption about application size, listed as outstanding after
clarification, was closed by measurement during planning: 2.6 MB across 28 files.
