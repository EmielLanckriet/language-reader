# ADR-0012: The Candidate Comparison Runs Laptop-Side, And Only The Winner Ships

**Status**: Accepted
**Date**: 2026-09-02
**Relates to**: Constitution Principle I, ADR-0007 (preserved option 3), spec
`003-real-segmentation` FR-026 to FR-031, SC-002, SC-008

## Context

Slice 2 must answer a question the anticipated-changes register has carried since before slice 0: is
the browser's built-in segmenter materially worse, on the reader's own material, than the
alternatives held in reserve. The spec requires a *recorded* comparison with quantified disagreement
and inspectable spans.

The obvious reading is that the application should contain the candidates and compare them. Measured
cost of that reading:

| | Size | Install multiple |
|---|---|---|
| Slice 1 install, as shipped | 1.40 MB | baseline |
| `Intl.Segmenter` | 0 bytes | 1.0× |
| CC-CEDICT, gzipped | 3.97 MB | ~3.8× |
| jieba frequency dictionary | 5.07 MB raw | ~2.5–4.6× |
| Pyodide + jieba | far larger again | 10×+ |

Slice 1's service worker builds its precache list from the build output, so any data file added is
downloaded before first use. Shipping the losers is not a lazy cost; it is paid by every install,
permanently, to answer a question once.

## Decision

**The candidate comparison is a committed script run on the laptop. The application ships one
analyzer.**

The script takes passages of the reader's own material, runs each candidate over them, and emits a
report: per-pair disagreement as a proportion, the disagreeing spans with each candidate's reading,
and short spoken-language lines reported separately from long prose. The report and its written
conclusion are committed to the repository.

Only the analyzer chosen on that evidence is implemented behind the language-provider seam and
shipped.

## Alternatives Rejected

- **Ship every candidate and compare in the application.** Rejected on measured cost: a permanent
  four-fold-or-worse install increase for a temporary question. It would also make `FR-035`'s
  no-regression requirement fail immediately.
- **Ship the candidates behind a developer-only flag.** Rejected because the data files are what
  cost, not the code, and a flag does not stop the precache from downloading them.
- **Compare on a standard benchmark corpus instead.** Rejected because the spec requires the
  reader's own material. A benchmark measures agreement with an annotator's notion of word-hood, and
  ADR-0002 already holds that word-hood is undefined and learner-dependent. The whole point is what
  *this* reader reads.
- **Skip the comparison and ship the free option.** Rejected because it is the question the slice
  exists to answer, and `FR-029` makes an absent conclusion a definition of unfinished.

## Consequences

**Easier.** Install size after slice 2 is unchanged from slice 1, so the reference-data budget is
satisfied trivially and `FR-035` holds by construction. Candidates can be added to the script freely,
including ones that would never be shippable, because nothing about the script constrains the app.

**Harder.** The comparison does not run on the device, so it measures the candidates rather than the
device's behaviour. This matters specifically for `Intl.Segmenter`, whose behaviour is the host's:
the laptop's ICU is not the phone's. ADR-0011's fingerprint is what makes that safe, and the phone
check must record the device's fingerprint so any difference is on record.

**Also harder.** Getting the reader's material into the script is manual — they paste passages into
files. Acceptable at this scale, and no content source in this slice would automate it anyway.

**Revisit if**: a candidate wins that needs its data shipped regardless for another reason.
CC-CEDICT is the live case: slice 3 wants it for glosses. Once it is being shipped anyway, using it
as a segmentation opinion costs nothing extra, and the trade-off here changes.
