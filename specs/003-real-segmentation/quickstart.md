# Quickstart: Validating Slice 2

**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

Four things must be proved. Three can be proved on a laptop. The fourth — that the phone's ICU
segments the way this laptop's does — cannot be, and Principle I means the slice is not complete
until it has been (`SC-009`).

## Prerequisites

```bash
nvm use                 # Node 24.20.0, per .nvmrc
npm ci
```

## The gates that run everywhere

```bash
npm run check           # types
npm run lint            # formatting and lint
npm test                # vitest, including the Principle II segmentation properties
```

Segmentation is on the constitution's mandatory test-first list, and it is tested **only on
properties** — never against expected segmentations. If a test in this slice asserts that 中国 comes
back as one token, it is wrong and must be deleted: word-hood is analyzer-dependent (ADR-0002), and
such a test encodes one ICU build's judgment and breaks on the next.

The properties that must exist:

| Property | Why it is the one that matters |
|---|---|
| Whole-document tiling | Catches a wrong delimiter set without anyone reasoning about the set |
| Offsets are code points, tested with astral input | The only defect in this slice that corrupts **earned** data |
| Determinism under a fixed fingerprint | Otherwise the analyzer stamp identifies nothing |
| Idempotence of re-derivation | The sweep and Path A both rely on it |
| Earned rows unchanged, asserted **exactly** | Earned data is asserted exactly; derived data never is |

## 1. The offset conversion, before anything else

The highest-risk line in the slice. `Intl.Segmenter` reports UTF-16 indices; this codebase is code
points throughout.

```bash
npm test -- offsets
```

The astral case is the whole point. On `𠮷野家很好` — five code points, six UTF-16 units — the
platform reports token indices 0, 2, 4. If the conversion is missing, everything still passes on
ordinary text and silently mis-anchors offsets the moment a name outside the BMP appears.

## 2. Real words, and the fingerprint

```bash
npm run dev
```

Paste `我在中国学习中文。他骑自行车去上班。` and open it.

Expect, from the measurements in research.md: 中国, 学习, 中文 and 上班 as single markable spans;
自行 and 车 as two, which is a known and recorded weakness, not a bug to fix in this slice. Word
boundaries must be visible (`FR-012`) — you cannot avoid a wrong mark you cannot see.

The reader route shows the analyzer and version. The version is a 16-hex-character fingerprint, not
`1`. Write it down: it is what the phone check compares against.

## 3. Re-derivation, both paths

The claim slice 0 made and never tested.

```bash
git stash                       # or check out the previous commit
npm run dev                     # import two or three documents under character-splitter
                                # mark a few single characters known
git stash pop
npm run dev
```

Then confirm:

- Opening a stale document shows real words, and you never re-imported it (`FR-015`).
- The documents you did **not** open become current on their own while the app sits idle
  (`FR-016`), visible on the diagnostics page.
- Marks made under the placeholder are all still there. Count them before and after — this is earned
  data and the count must be **identical**, not approximately so (`FR-023`).
- A character you marked that now only appears inside a longer word is still recorded against the
  same word identity (`FR-025`). Check this in the test suite, not the interface: no screen displays
  vocabulary yet, which is a gap slice 2 documents rather than closes.
- Kill the tab mid-sweep and reopen. No document shows one analyzer's tokens under another's stamp,
  and the remaining work resumes (`FR-020`, `FR-021`).

Open a second tab to check the lease rule: the copy without storage must not sweep (`FR-019`).

## 4. The comparison, and the written conclusion

Laptop-side, never shipped ([ADR-0012](../../docs/adr/0012-candidate-comparison-runs-laptop-side.md)).

```bash
node scripts/compare-segmenters/run.mjs
```

Put passages of **your own** material in that directory first — at least five, of which at least two
are subtitle- or transcript-like short lines (`SC-007`). Not a benchmark corpus: the question is what
*you* read.

The report must give per-pair disagreement as a proportion, show the disagreeing spans with each
candidate's reading of them, and report short lines separately from long prose (`FR-026`–`FR-028`).

Then hand-mark the words in one 500-character passage and record the proportion the shipped analyzer
produced as single tokens (`SC-001`). There is no threshold to hit. What is gated is that the shipped
analyzer is the best candidate you actually measured — or that a written justification says why it
is not — and that the figure is recorded as the baseline (`SC-002`).

The slice is not finished until the conclusion is written down (`FR-029`).

## 5. Install size stays put

```bash
BASE_PATH=/language-reader npm run build
```

`scripts/check-bundle.mjs` runs in postbuild and gains an install-size budget in this slice, so a
regression fails the build rather than shipping. Slice 1's measured baseline is **1.40 MB across 34
files**.

Shipping `Intl.Segmenter` adds **zero bytes**, so the expected outcome is no material change. If this
check fails, something pulled a candidate's dictionary into the bundle — which is exactly what
keeping the candidates out of `src/` is meant to prevent.

## 6. On the phone — the gate

```bash
npm run preview         # then deploy
```

Per Principle I, nothing above counts until this passes.

- Install from the home screen, enable aeroplane mode, restart the device, open a document, and read
  it with real words (`SC-005`).
- Mark a multi-character word in one action (`SC-006`).
- Open a 5,000-character document and confirm it appears within 3 seconds (`SC-004`). Segmentation
  measured at 3.8 ms on the laptop, so if this fails, look at storage and rendering, not the
  segmenter.
- **Record the analyzer fingerprint shown on the device** and compare it to the laptop's. This is the
  one fact no laptop measurement can supply. If they differ, that is not a failure — ADR-0011 exists
  precisely so that a difference re-derives rather than corrupts — but it must be written down.
