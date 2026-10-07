# ADR-0037: In-context outcomes, shown English, and fitted rules

**Status**: Accepted for spec 013
**Date**: 2026-10-04
**Revises**: ADR-0033

## Decision

Understanding in context is the measured goal; card grades remain a cleaner proxy. In a
non-withdrawn session a tap is an in-context failure; in a session answered "every unknown word",
an untapped word read with the text visible and no English shown over it is an in-context
success. Both are noisy labels with fitted reliabilities, scored and reported apart from card
grades. A word under English the reader saw is neither: no outcome, no credit (`evidence-3`).
Taps lose their "I knew it" qualification; a mistaken tap is undone while its sheet is open.

Lookups and exposures update memory through their own rules (multiples of FSRS's Again and Good
steps) whose strengths are fitted, so today's rule is the fit's starting point. One unrounded
FSRS-6 engine serves production and fitting. The fit uses earlier outcomes only, a prior centred
on the Anki weights, and may be applied only when it predicts in-context outcomes better on the
later period, with enough data, and cards no worse. Activations are append-only; rollback is
always allowed. Fitting runs on the laptop first, then in Reader under ADR-0032's bounds.

## Alternatives and consequences

ADR-0033 kept lookups and attentive exposures as interventions only, fearing labels the system
invents; these labels are what the reader did and reported, not inferred grades. Stock optimizers
fit card grades only. Hand-derived gradients are faster but large and rule-specific. Applying any
set with a warning was declined by the reader in favour of the guard.

Consequences: memory shifts once when `evidence-3` ships (past checks become taps, helped words
lose their Good). Older sessions count as blurred unless a blur-off was recorded. The guard means
nothing can be applied until about 100 later in-context outcomes exist. Listening has inputs but
no outcome yet.

## Amendment 2026-10-07: the verdict informs, it does not forbid

The reader reversed the guard: with 92 later in-context outcomes, every fit stopped at "too little
data" and the Learning data table could not change. A fitted set can now be applied whatever its
verdict, shown beside it, with **Apply anyway** for a set that did not pass; `applyParameters` no
longer checks `applicable`. It still refuses an altered set or one fitted against a set no longer
in force, since its verdict would then describe a different comparison. Return stays exact, so a
set applied too early is undone in one step. The verdict and its minimum of 100 are unchanged.
