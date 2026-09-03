# ADR-0014: The Reader Carries Its Own Chinese Word List

**Status**: Accepted
**Date**: 2026-09-03
**Relates to**: ADR-0007 (no server), ADR-0011, ADR-0012, Constitution Principle I,
spec `003-real-segmentation` FR-032 to FR-035

## Context

Slice 2 shipped `Intl.Segmenter` on the strength of two measurements: it is correct on ordinary
Chinese, and it costs zero bytes (research.md R1, R5). Both were taken on a laptop.

On the reader's Android phone it returns **one token per character**. Confirmed rather than inferred:
the analyzer's fingerprint there is `7db96c05`, and the hash of a character-per-character
segmentation of the same probe is exactly `7db96c05`, while both Node and desktop Chrome produce
`75323e0d` (research.md R11).

ICU's word breaking for languages without spaces is dictionary-driven, and those dictionaries —
Chinese/Japanese, Thai, Khmer, Lao, Burmese — are around 2.9 MB of separable data a browser build
can omit. A build without them still exposes `Intl.Segmenter`, still accepts
`granularity: 'word'`, and still answers; the answer is character breaks. There is no capability
flag to test, and the API deliberately does not expose ICU's custom-dictionary support, so nothing
can be supplied to repair it from JavaScript.

The constitution treats the phone as the oracle. An analyzer that works everywhere except there
does not work.

## Decision

**The reader ships its own Chinese word list and segments against it, rather than relying on the
platform.**

The list is CC-CEDICT's headwords and nothing else: 120,176 simplified entries, 1.00 MB on disk,
**0.432 MB gzipped over the wire**, precached with the rest of the build so it is on the device
after the first install and no reading depends on a network.

Segmentation is greedy longest match, forward, over runs of Han characters. The analyzer's version
declares the word list's content hash, so regenerating the list restamps every document and
re-derives it.

`Intl.Segmenter` is **not removed**. It stays as the thing the comparison harness measures against,
and as what a device with complete ICU data would use if that ever became worth doing. It is simply
not what the reader reads with.

## Alternatives Rejected

- **Keep `Intl.Segmenter` and accept the phone.** Rejected: it is the whole slice's purpose, and on
  the target device it produces exactly the character-per-token output slice 0 shipped as a
  deliberate placeholder.
- **Detect the missing dictionary and fall back.** Rejected because the platform gives nothing to
  detect. It could be inferred by probing — segment a known compound and see whether it holds
  together — but a reader whose words silently depend on which browser they opened is worse than
  one whose words are the same everywhere, and the fallback would have to ship the word list
  anyway, so the branch buys nothing but two behaviours to reason about.
- **Ship CC-CEDICT complete, with definitions.** Rejected for now: 3.97 MB gzipped against 0.432 MB
  for headwords alone, and segmentation does not read definitions. If slice 3 wants glosses it can
  pay for them then — and it may not, since the developer already uses Pleco for lookups.
- **Ship jieba's frequency dictionary and score a maximum-probability path.** Better segmentation —
  it resolves ambiguities longest-match cannot, and the register says so — but 1.62 MB gzipped
  against 0.432 MB, and its advantage over longest match on *this reader's* material has not been
  measured. Deferred to a measurement, not to an opinion.
- **jieba via Pyodide** (ADR-0007's preserved option 1). Rejected on size: a Python runtime plus the
  package, against an application that was 1.03 MB over the wire.

## Consequences

**Easier.** Segmentation is now the same on every device, and it no longer depends on a capability
no API reports. The word list is data with a content hash, so improving it is a regeneration and a
re-derivation rather than a migration.

**Harder.** The install roughly doubles the download, from about 1.03 MB to about 1.46 MB. That
exceeded the budget ADR-0012's reasoning set, and FR-034's requirement — that exceeding it carries a
written justification rather than a quietly raised ceiling — is discharged by this ADR and by the
comment in `scripts/check-bundle.mjs`.

**A known regression, stated rather than discovered.** Greedy longest match is context-free, so it
walks into the ambiguity `Intl.Segmenter` handled correctly: 结婚的和尚未结婚的人 becomes
结婚 / 的 / **和尚** / 未 / 结婚 / 的 / 人. On the phone this is not a regression at all — every
character was separate before — but against desktop `Intl.Segmenter` it is. Frequency weighting is
the known fix and it is a measurement away.

**Revisit if**: the comparison on the reader's own material shows frequency weighting worth its
1.6 MB; or a browser ships CJK dictionary data everywhere the reader reads, which would make the
platform segmenter free again but would not make it *uniform*, which is now also a reason to keep
this one.
