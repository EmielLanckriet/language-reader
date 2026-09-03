# Segmentation comparison harness

**This never ships.** It answers a question once — which segmentation approach the application
should use — and is run on a laptop, not on the device. See
[ADR-0012](../../docs/adr/0012-candidate-comparison-runs-laptop-side.md) for why: CC-CEDICT and
jieba's frequency dictionary each cost megabytes, against an application that installs at 1.40 MB
today, and slice 1's service worker precaches every file in the build output automatically. Shipping
the candidates to answer a question that expires the moment it is answered would multiply the
install permanently for a temporary benefit.

Nothing here implements the application's `Analyzer` interface
(`specs/001-reader-walking-skeleton/contracts/analyzer.md`), and nothing here imports from `src/`.
An interface built for implementations that are not shipping would be exactly the speculative
generality Constitution Principle V forbids.

## Running it

```
node scripts/compare-segmenters/run.mjs
```

Requires passages in `passages/` (see `passages/README.md` — the directory starts empty and the
harness refuses to run, with an explanatory message, until passages are added) and network access
the first time each data-dependent candidate runs (to fetch its reference data — a dictionary for
`cedict-longest-match` and `frequency-path`, a model and vocabulary for `bert-ws`). Fetched data is
cached under `data/`, which `.gitignore` excludes — **a dictionary or model must never be
committed**. Delete `data/` to force a re-fetch. `bert-ws`'s model is ~98 MB, so expect its first run
to take noticeably longer than the others; the harness reports download progress while it fetches.

The report is written to `report.md` in this directory (overwritten each run) and printed to stdout.

## Candidates

| Candidate | What it does | Data fetched | Measured size (research.md R5) |
|---|---|---|---|
| `intl-segmenter` | `Intl.Segmenter('zh', {granularity:'word'})` — rejected: returned every character separate on the reader's own Android Chrome (research.md R11) | none | 0 bytes |
| `cedict-longest-match` | greedy longest match against CC-CEDICT headwords (traditional and simplified) | CC-CEDICT (MDBG export) | 3.97 MB gzipped |
| `frequency-path` | maximum-probability path over jieba's word-frequency dictionary — the same DAG-plus-dynamic-program jieba runs before its HMM layer | jieba's `dict.txt` | 5.07 MB raw |
| `bert-ws` | `bert-ws-zh` — the analyzer the application ships (ADR-0015): a contextual token-classification model (quantised ONNX), decoded into B/I word-boundary tags | Xenova/bert-base-chinese-ws (quantised model + vocabulary) | ~100 MB fetched on demand at first use, not part of the install (ADR-0015) |

**On `intl-segmenter` and `bert-ws` both**: each is a reimplementation of the corresponding shipped
(or once-shipped) TypeScript, not a call into it — `intl-segmenter` mirrors
`src/lib/analyzer/chinese.ts` as it read while it was still shipped, and `bert-ws` mirrors
`src/lib/analyzer/bert-tokenizer.ts`, `src/lib/analyzer/tagger.ts` and
`src/lib/analyzer/bert-tagger.ts`. This harness is plain `.mjs`; that TypeScript uses extensionless
imports, so it cannot be imported here without either building it first (which would blur the "never
bundled, never depends on `src/`" boundary this directory exists to hold) or duplicating it.
Duplication was chosen for both, and it is a named risk, not a solved one: **nothing enforces that
these candidates and `lib/units.mjs`/`lib/offsets.mjs` stay in step with the application's own
analyzer code.** If the shipped analyzer changes and its candidate here is not updated to match, that
candidate silently stops measuring what the application does, and any conclusion drawn about "the
shipped analyzer" would actually be about something else. Whoever next changes the shipped analyzer
code should re-check the matching candidate by hand; there is no test that would catch drift between
the two.

**On `bert-ws` specifically**: unlike the other three candidates, `segmentUnit` is `async` — running
the model is inherently asynchronous — and `run.mjs` awaits every candidate's result to accommodate
it. Its data is ~100 MB (a ~98 MB quantised model plus a 21,128-entry vocabulary), fetched from
Hugging Face at first use and cached under `data/` like every other candidate's dictionary — never
committed. The vocabulary is fetched from its original upstream source rather than read from the
application's committed `static/bert-vocab-zh.txt`, which is a build artefact this harness does not
generate; depending on it would make this harness break, or silently drift, for a non-obvious reason
if that file were regenerated or removed.

**On `frequency-path`**: it deliberately does **not** implement jieba's HMM-based new-word discovery
— that is a genuinely different technique layered on top of the frequency path, not a detail of it,
and claiming to reproduce jieba while quietly omitting the part that handles words absent from its
dictionary would be exactly the "candidate that is not what it claims to be" this project's reporting
standard forbids. What is implemented is the dictionary-and-frequency core: a directed graph of every
dictionary word that could start at each position, and the maximum-log-probability path through it.
A character reachable by no dictionary word falls back to a frequency of 1 (matching jieba's own
`FREQ.get(word, 1)`), which is what keeps every character reachable (no character is ever silently
dropped) without pretending a statistical model is doing the work.

## The metric (T034, FR-027)

For a segmentation unit of *L* code points, there are *L*−1 **internal positions** — the gaps
between adjacent characters. Each candidate places a word boundary at some subset of those
positions. For a pair of candidates, the disagreement proportion is:

```
(number of internal positions where exactly one of the two places a boundary)
/ (total internal positions measured across every unit in the group)
```

This is a literal reading of "the fraction of positions where the candidates disagree about whether
a word boundary falls there." Words are not counted directly, because two candidates' words rarely
line up in count or length — comparing "3 words disagree" against "5 words disagree" says nothing
useful, while every unit has an unambiguous, comparable number of character positions.

## Disagreeing spans (T035, FR-027)

A position where **every available candidate** places a boundary is a safe place to cut: every
candidate's own tokens end exactly there. Those universal cuts (plus the unit's own start and end)
divide a unit into cells. A cell where every candidate reads a single token is agreement and is not
reported. A cell where any candidate splits it further is a genuine disagreement, and the whole cell
— not just the one contested position — is reported, together with what every available candidate
read that cell as, so a human can judge which reading is right rather than only see that they
differ.

## Short lines versus long prose (T036, FR-028)

Passages are plain `.txt` files with no metadata, so classification is inferred from physical line
length. A line at or under 20 code points is treated as short spoken-language material (the
subtitle- and transcript-like content this tool exists to serve); anything longer is long prose. The
threshold is a documented judgment call — professional Chinese subtitling guidance commonly caps a
line around 16-20 characters for readability — not something measured from this reader's own
material, because there was none to measure from when the harness was built. The report gives both
groups a separate set of pairwise proportions and disagreeing spans, plus a combined "overall"
section for reference that is not a substitute for the split.

## Design decision: all candidates share one delimiter set

Every candidate is run one segmentation unit at a time, using the **same** Chinese delimiter set
(line breaks and CJK sentence-final punctuation, excluding the ASCII full stop — ADR-0013), copied
from `src/lib/analyzer/chinese.ts`/`src/lib/analyzer/delimiters.ts`. This is deliberate: which
characters can appear inside a Chinese word is a fact about Chinese, not a property of any one
candidate's algorithm. Holding it fixed across all four keeps the comparison about how each
candidate segments words within a unit, rather than about incidental differences in how each one
would handle line breaks and sentence punctuation if left to invent its own rule.

## What this harness does not do

It does not decide which analyzer ships — that decision weighs the measured quality difference
against the measured install cost (ADR-0012, SC-002), and it is made by the main session, not this
script. It also does not hand-annotate a passage (SC-001) or write the slice's final conclusion
(FR-029) — those need the reader's own judgment of word-hood on their own material, which this
harness cannot supply.
