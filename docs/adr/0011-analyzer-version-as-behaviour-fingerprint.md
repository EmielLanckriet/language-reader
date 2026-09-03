# ADR-0011: An Analyzer's Version Is A Fingerprint Of Its Behaviour

**Status**: Accepted
**Date**: 2026-09-02
**Relates to**: Constitution Principle V (earned versus derived data), ADR-0002, ADR-0003,
spec `003-real-segmentation` FR-009, FR-010

## Context

Slice 0 established that every document records the `analyzer` and `analyzer_version` that produced
its tokens, and that this is what makes replacing an analyzer a recompute rather than an
untraceable change. It works because a hand-written analyzer knows its own version.

Slice 2 ships an analyzer that does not. `Intl.Segmenter` is provided by the browser, backed by
whatever ICU that browser embeds. It exposes no version. Measured here: Chrome on Android and Node
24.20.0 on the laptop are different ICU builds, and there is no API that admits it.

A hard-coded `version: "1"` would therefore be false in a specific and damaging way. Two devices, or
one device before and after a browser update, would stamp different tokenisations with the same
version. Nothing would detect it, and documents segmented under two different ICUs would sit mixed
in one library with no way to tell them apart afterwards.

Measured, on the fixed probe string committed with the analyzer: hashing the segmenter's output is
stable across repeated calls and across freshly constructed instances.

## Decision

**An analyzer whose behaviour is supplied by its host MUST derive its `version` from its behaviour,
not declare it.**

The Chinese analyzer computes its version once at startup by segmenting a fixed, committed probe
string and hashing the resulting `(offset, text)` sequence. That hash is the version recorded on
every document it analyses.

The probe string is part of the analyzer's source, is never edited casually, and changing it is
equivalent to renaming the analyzer.

Analyzers whose behaviour lives in our own code keep declaring a version by hand. This rule applies
only where the host owns the behaviour.

## Alternatives Rejected

- **A hard-coded constant.** Rejected because it is untrue across devices and across browser updates,
  and the untruth is undetectable. This is the option that looks simplest and creates the
  unrecoverable state.
- **A version derived from `navigator.userAgent`.** Rejected because it is a proxy for ICU rather
  than ICU: it changes when nothing about segmentation changed, causing pointless re-derivation, and
  it can stay fixed while the underlying ICU data moves.
- **Shipping our own ICU build.** Rejected because the entire reason to use `Intl.Segmenter` is that
  it costs zero bytes. Slice 1's install is 1.40 MB; bundling ICU would dwarf it.
- **Not versioning at all and re-deriving on every open.** Rejected because it makes the analyzer
  stamp meaningless and turns a rare correction into constant work.

## Consequences

**Easier.** Drift in the host's segmentation becomes self-healing. A browser update that changes ICU
changes the fingerprint, documents no longer match their stamp, and the re-derivation path this
slice already builds brings them up to date. No separate migration, no detection code, no alert.

**Harder.** The version is opaque — `a3f19c02` says nothing to a human, unlike `pkuseg-0.0.25`. The
diagnostics surface must therefore show it alongside the analyzer name, and the phone check must
record the fingerprint observed on the device so that a laptop-versus-phone difference is a fact on
record rather than a suspicion.

**Also harder.** Fingerprint changes trigger re-derivation of every document. That is correct
behaviour, but it means a browser update can cause a burst of background work. The sweep's
obligation to yield to the reader is what keeps that acceptable.

**Revisit if**: the platform ever exposes an ICU or CLDR version directly, in which case that becomes
a cheaper and more legible input to the same stamp; or if fingerprint churn proves frequent enough
that re-derivation cost outweighs the correctness it buys.
