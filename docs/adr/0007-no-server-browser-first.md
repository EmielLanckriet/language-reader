# ADR-0007: No Server; Browser-First

**Status**: Accepted
**Date**: 2026-09-01
**Relates to**: Constitution Principles I and II, Additional Constraints (v1.4.0); ADR-0003;
ADR-0005; ADR-0006

## Context

The architecture had assumed a Python backend on Fly.io with SQLite on a persistent volume. That
assumption was inherited from an early claim — mine — that Python was *forced* because the Chinese
NLP libraries are Python. Two things undermined it.

`Intl.Segmenter` ships ICU's Chinese word-segmentation dictionaries in every current browser and
in Node, with nothing to download, so segmentation does not require Python. And the developer
corrected a characterisation I had recorded backwards: the reason for deploying rather than
running from a laptop is that they are a **phone user who needs the app available**, not a
preference for server-side computation. They prefer computation local, ideally on-device, where
feasible.

The decisive constraint is neither of those. It is a fact about the developer rather than the
technology:

> "I am prone to not maintaining the subscriptions or whatever, and since this is a hobby project
> I want to keep it as cheap as possible."

A design that depends on an ongoing subscription the owner knows they will not maintain is a
design that fails. This is not a cost optimisation; it is a reliability requirement, and it
outranks the technical arguments on either side.

Two further requirements point the same way. Offline reading is non-negotiable and in the
constitution at the developer's insistence. And the data — word states and their history — is
earned, irreplaceable, and none of anyone else's business.

## Decision

**There is no server.** The application is a browser-based, installable web app served from
static hosting, with all reader data stored on the device.

- **Data** lives in browser storage on the phone. Nothing is rented; nothing can lapse.
- **Analysis** runs in the browser. `Intl.Segmenter` provides segmentation; pronunciation and
  dictionary data are a JavaScript library and a data file respectively.
- **Hosting** is a free static host requiring no payment method, so there is nothing to expire.
  The repository holds code only; reader data never reaches it.
- **Offline** follows by construction rather than by engineering.

**Three options are explicitly PRESERVED, not rejected.** Each is additive, and preserving them
costs nothing now:

1. **Pyodide** — CPython on WebAssembly, running jieba and pypinyin (both pure Python) in the
   browser. The cost is a one-off download on the order of ten megabytes, cached once the app is
   installed, plus a second or two of interpreter startup — which lands on import, not on reading,
   and is therefore off the hot path. This is a genuine answer to losing pkuseg, and would be the
   language-provider seam's third implementation.
2. **A native wrapper** (Capacitor, Tauri) over the same codebase, if browser storage guarantees
   prove insufficient. A web codebase can be wrapped later; a native codebase cannot easily be
   unwrapped, which is why web comes first.
3. **A laptop-side Python import tool**, analysing a text with better models — the developer
   already runs Qwen3-4B locally — and handing the phone a file. No server, no subscription, and
   it matches how they already work with `sentencegen` overnight.

**Storage durability is addressed, not assumed.** The app MUST request persistent storage via
`navigator.storage.persist()`, which Chrome on Android grants to installed apps, and MUST provide
an export file early. Browser storage is evictable by default; an installed app with persistence
granted is not evicted automatically, and the residual risk — the user clearing site data — is
what the export covers. This is the arrangement Anki already uses: a local collection plus an
export.

## Alternatives Rejected

**Stateful server on Fly.io, as previously specified.** Rejected on the developer's constraint: it
requires a payment method and accrues monthly cost, and an unmaintained account is a data-loss
event rather than an inconvenience. It also puts irreplaceable earned data on rented
infrastructure that then needs backing up.

**A stateless analysis service, with data still on the device.** This was my recommendation before
the cost constraint was stated, and it is technically the strongest option: near-zero cost, scales
to zero, holds nothing, and permits pkuseg. Rejected anyway, because "near-zero" is not zero and
it still requires an account with a payment method — which is exactly the failure mode named. A
service that costs nothing but *can* lapse is worse than no service.

**Native Android app first.** Rejected. It offers stronger storage guarantees, but costs a build
toolchain, a signing and release step, and the laptop. The wrapper option above obtains most of
the benefit later, from the same codebase, only if it turns out to be needed.

**Pyodide from the start, to keep jieba.** Rejected for slice 1 as premature: it trades a
measurable download and startup cost for an unmeasured quality gain, since nobody has compared
`Intl.Segmenter` with jieba on text this reader would actually read. Preserved as option 1 above,
to be decided by measurement.

## Consequences

**Easier.** Zero recurring cost and nothing that can lapse, which was the requirement. Offline is
structural rather than engineered. No irreplaceable data on infrastructure someone else operates.
Slice 0 becomes materially smaller: no backend, no database server, no volume, and no access
credential, since there is no server to authenticate to.

**Harder — and this is the real cost.** **pkuseg is lost**, and confirmed so rather than assumed:
it publishes platform-specific wheels with compiled extensions, so it is not installable in
Pyodide off the shelf; using it would mean building a wheel for emscripten and shipping its model
files. Pyodide brings jieba (pure Python) and pypinyin (a pure wheel), but jieba is the segmenter
that was rejected as too weak in the first place. pkuseg was chosen because segmentation quality
is a known annoyance from the developer's own use of comparable tools, and `Intl.Segmenter` is
likely below it.

Four things mitigate, and the fourth is the strongest: the vocabulary overlay, where the reader's
known words override the dictionary and improve as they read; manual correction, scheduled for
slice 2 and always the real answer; options 1 and 3 above; and **ensemble segmentation with
disagreement-triggered escalation** (see `docs/anticipated-changes.md`), which extracts quality
from structure rather than from any single better model, and which fixes the one thing hybrid
analysis could not — a boundary error, because two segmenters disagreeing keeps *both* candidates
visible rather than losing the compound before anything can flag it.

None of these is measured yet, and the mitigation should not be assumed sufficient.

**Cross-device stops being free.** A single server previously made phone and laptop agree by
construction. That now requires an export file or real sync, and has been dropped from slice 0 by
decision.

**The domain core becomes TypeScript.** Principle II's tooling moves from pytest and hypothesis to
vitest and a property-based library; the discipline and the mandatory list are unchanged. ADR-0005
retargets its verified kernel from `-t:py` to `-t:js`, **confirmed working**: the same lemmas
verify, `Status.js` is emitted and runs under Node, requiring `bignumber.js` as an npm dependency
because Dafny integers are arbitrary-precision.

**Every earned-data decision survives untouched** — surrogate lexeme identity, retained raw
content with a content type, analyzer name and version, provenance, owner, the append-only
history, character-offset anchoring, and dual timestamps. Two become *more* load-bearing: the
append-only history is how multi-device merge works without conflict resolution, and the dual
timestamps are its input. That they survived a change this large is the payoff from Principle
V's requirement that the domain core stay independent of its delivery mechanism.

**Revisit if.** Measurement shows `Intl.Segmenter` is materially worse than jieba on real reading
material and neither the vocabulary overlay nor manual correction closes the gap — in which case
option 1 is taken. Or browser storage proves unreliable in practice despite persistence being
granted, in which case option 2 is taken. Both are additive; neither requires revisiting this
decision's core, which is that nothing may depend on a subscription.
