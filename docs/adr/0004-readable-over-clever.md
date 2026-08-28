# ADR-0004: Readability As A Constraint

**Status**: Accepted
**Date**: 2026-08-28
**Relates to**: Constitution Principle VII (added in v1.3.0); ADR-0005

## Context

The developer is learning software engineering through this project rather than arriving with it.
Reading the code is therefore not a maintenance overhead to be minimised — it is a substantial
part of the point. Code that works but cannot be followed has failed at something this project
actually values.

This had been operating as an unstated preference and was already deciding real tradeoffs without
being written down:

- SvelteKit was chosen over React despite React having far more model training data behind it,
  because Svelte produces less code per unit of interface and the binding constraint is volume of
  generated code to review, not model fluency.
- Plain numbered SQL migrations were chosen over SQLAlchemy plus Alembic, because the three
  schema hedges (`provenance`, `user_id`, `status_event`) must be visibly correct rather than
  trusted.

Leaving such a load-bearing criterion unwritten means it gets traded away silently whenever
something else is locally convenient.

A tension surfaced when Dafny was proposed for verified kernels (ADR-0005): Dafny compiles to
Python that is verbose, machine-shaped, and not worth reading. Under a naive reading of a
readability principle, shipping it would be a violation.

## Decision

**Readability is a first-class constraint, ranked above brevity and above cleverness.** Where a
shorter, more elegant, or more idiomatic construction is harder to follow than a longer plain
one, the plain one wins.

Concretely this means: explicit over implicit; a named intermediate variable over a dense
expression; a longer function with a clear sequence over a short one requiring several inferences;
standard library constructs over idioms that require knowing a framework's conventions; and
comments that explain *why* rather than restating *what*.

**Carve-out — source versus artifact.** The principle applies to code a human is expected to read
and modify. It does not apply to generated artifacts, which are judged by whether their *source*
is readable. Compiler output is not held to the standard of the language it was compiled from —
one does not read assembly to justify writing C.

A generated artifact qualifies for this carve-out only if all of the following hold:

1. Its source is in the repository, is readable, and is the thing that gets edited.
2. Generation is reproducible by a committed command.
3. It sits behind an interface a human did write.
4. The artifact is never hand-edited. Edits go to the source and it is regenerated.

Dafny-generated Python satisfies these. Code merely *produced by an agent* does NOT — that code
has no other source, is edited directly, and is therefore held fully to the principle.

## Alternatives Rejected

**Leave readability as an unstated preference.** Rejected: it was already silently deciding
framework and migration-tooling choices, and unwritten criteria are the ones traded away first
when something else is locally convenient.

**Rank readability above correctness or above verification.** Rejected. This would forbid Dafny
outright, and would sacrifice a guarantee for a property that the source/artifact carve-out
preserves anyway.

**Apply the principle to all committed code including generated output.** Rejected as the naive
reading. It would ban every compiler, bundler, and code generator, and would confuse the artifact
with the thing that determines it.

**Extend the carve-out to agent-generated code generally**, on the argument that the prompt is
the source. Rejected, and the rejection matters more than the others here. Agent-generated code
fails conditions (1), (2) and (4): the prompt is not retained as an editable source of truth,
generation is not reproducible, and the output is edited directly thereafter. Treating it as a
generated artifact would exempt the overwhelming majority of this codebase from the principle and
hollow it out entirely.

## Consequences

**Easier.** Framework and tooling choices now have a written criterion to be argued against rather
than resolved by taste. The project stays legible to its author, which is a stated goal rather
than a nicety. Review of generated code has an explicit standard: it must be followable, not
merely correct.

**Harder.** Some code will be longer than it needs to be. Idiomatic constructions that a
professional would reach for without thinking are sometimes prohibited, which means occasionally
writing code that a more experienced reader would consider naive. This is an accepted cost.

The carve-out requires discipline: the moment a generated artifact is hand-edited, it stops being
an artifact and becomes source, and falls under the full principle.

**Revisit if.** The developer's fluency grows to where the plain-over-idiomatic rule is producing
code that is *harder* to read for being verbose. Readability is the goal; plainness is only the
current proxy for it, and the proxy should be retired when it stops tracking the goal.
