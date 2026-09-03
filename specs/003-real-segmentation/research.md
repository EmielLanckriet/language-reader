# Phase 0 Research: Real Segmentation, Measured (Slice 2)

**Date**: 2026-09-02 | **Branch**: `003-real-segmentation`

Every finding below was **measured**, not read. That is a standing rule on this project after slice
1, where two near-misses came from trusting a description rather than checking the artifact. Where
something here rests on documentation rather than measurement, it says so.

Reproduction scripts are throwaway; the durable versions become the comparison harness in
`scripts/`.

---

## R1. What `Intl.Segmenter` actually does to Chinese

**Method**: Node 24.20.0 (the version in `.nvmrc`), `new Intl.Segmenter('zh', {granularity:'word'})`,
run over hand-picked cases including the ambiguities the register names by name.

| Input | Output | Verdict |
|---|---|---|
| 我在中国学习中文 | 我在 / 中国 / 学习 / 中文 | **wrong** — 我 + 在 merged into a non-word |
| 他骑自行车去上班 | 他 / 骑 / 自行 / 车 / 去 / 上班 | **wrong** — the exact compound split the register predicted |
| 三个人在那里 | 三 / 个人 / 在 / 那里 | **wrong** — 个人 ("individual") read where 三 个 人 was meant |
| 玛丽亚是我的朋友 | 玛丽 / 亚 / 是 / 我的 / 朋友 | **wrong** — proper name split, as expected for a dictionary method |
| 结婚的和尚未结婚的人 | 结婚 / 的 / 和 / 尚未 / 结婚 / 的 / 人 | **correct** — avoids the 和尚 trap |
| 花钱买花 | 花钱 / 买 / 花 | **correct** — the register's own worked example |
| 我们看看吧 | 我们 / 看看 / 吧 | correct; reduplication kept whole |
| 国务院总理今天出席了会议 | 国务院 / 总理 / 今天 / 出席 / 了 / 会议 | correct |
| 这个问题很难解决 | 这个 / 问题 / 很 / 难 / 解决 | correct |
| 我帮了他一个忙 | 我 / 帮 / 了 / 他 / 一个 / 忙 | correct as far as a contiguous tagger can go; 帮…忙 is out of scope by construction |
| 我用 Python 3.14 写程序。 | 我 / 用 / Python / 3.14 / 写 / 程序 / 。 | correct; Latin and digits handled, punctuation non-word |

**Decision**: `Intl.Segmenter` is good enough to ship as slice 2's analyzer and is demonstrably not
good enough to be the end state.

**Rationale**: it is correct on ordinary text and on two of the hard cases the register worried
about, and wrong in a characteristic way — it under-recognises compounds and names. That is exactly
the failure profile a dictionary method has, and exactly what the register said a contextual tagger
would later fix. Shipping it costs nothing and produces the baseline every later candidate is
measured against.

**Alternatives considered**: see R5. All of them cost megabytes; this one costs zero bytes.

---

## R2. `Intl.Segmenter` offsets are UTF-16, and this codebase is code points

**Method**: segment `𠮷野家很好`, where 𠮷 (U+20BB7) is one code point and two UTF-16 units.

```
UTF-16 length: 6 | code points: 5
index=0 "𠮷"   index=2 "野家"   index=4 "很好"
```

**Decision**: the Chinese analyzer MUST convert every `index` from UTF-16 code units to code points
before returning a token, using the existing `domain/offsets.ts`. This conversion is the adapter's
single most important job and MUST be tested with astral-plane input.

**Rationale**: this is a silent-corruption bug, not a cosmetic one. Obligation 2 of the analyzer
contract already requires code points, and `status_event` carries `from_offset` / `to_offset` —
**earned data** — anchored on character offsets. Passing ICU's indices through unconverted would
produce tokens that look right in any text made only of BMP characters and are wrong the moment one
astral character appears, retroactively mis-anchoring judgments already recorded. It is precisely
the class of defect that "write the check before the fix" exists to catch.

**Note on likelihood**: rare in everyday simplified Chinese, common in names and in CJK Extension B.
Rarity is why it would ship undetected, not a reason to accept it.

---

## R3. A host-provided segmenter cannot be versioned — so version it by behaviour

**Problem**: `FR-009` requires recording which analyzer and version produced a document's tokens, and
`FR-008` requires determinism for a given name and version. `Intl.Segmenter` exposes no ICU version,
and the ICU shipped by Chrome on Android is not the ICU in Node here. A hard-coded `version: "1"`
would be a lie: the same stamp would describe different tokenisations on different devices and after
browser updates.

**Method**: hash the segmenter's output over a fixed probe string; check stability.

```
fingerprint of probe output: 29aef947ef0d39e0   (22 tokens)
stable across instances: true
```

**Decision**: the Chinese analyzer's `version` is a **behaviour fingerprint** — a short hash of its
tokenisation of a fixed, committed probe string — computed once at startup, not a hand-written
constant. Recorded in [ADR-0011](../../docs/adr/0011-analyzer-version-as-behaviour-fingerprint.md).

**Rationale**: it converts an unversionable dependency into a versioned one, and it makes ICU drift
**self-healing**. If a browser update changes segmentation, the fingerprint changes, documents no
longer match their stamp, and the re-derivation machinery this slice is already building
(`FR-013`–`FR-021`) brings them up to date without anyone noticing the drift happened. The
alternative — discovering months later that documents segmented under two different ICUs are
silently mixed — has no recovery path.

**Cost**: one segmentation of a short probe string at startup. Measured at well under a millisecond.

**Alternatives rejected**: a hard-coded constant (lies across devices); `navigator.userAgent` (a
proxy for ICU, not ICU, and changes for unrelated reasons); shipping our own ICU (defeats the point
of using the built-in one).

---

## R4. Performance is not a constraint, and unit-at-a-time is free

**Method**: 5,000 code points of realistic mixed prose, whole-document versus split on line breaks
and CJK sentence punctuation per `FR-002`.

```
document code points: 5000
whole document : 3084 tokens in 3.8 ms
unit at a time : 3084 tokens in 2.9 ms across 213 units
identical tokenisation: true
```

**Decision**: segment unit-at-a-time as `FR-002` requires, and stop treating `SC-004`'s three-second
target as a segmentation budget.

**Rationale**: 3.8 ms against a 3,000 ms budget means segmentation is roughly a thousandth of the
allowance. Whatever makes opening a document slow, it is storage and rendering, not this. Unit
splitting cost nothing measurable and produced **byte-identical** tokenisation on this sample, which
is the expected result — ICU already breaks at the punctuation the delimiter set names — and it
means `FR-002` buys its safety guarantee for free rather than trading quality for it.

**Caveat, honestly flagged**: measured in Node on a laptop, not in Chrome on the phone. The margin is
three orders of magnitude, so the conclusion is robust to a large constant factor, but the phone
check (`SC-009`) is what confirms it.

---

## R5. What the alternatives cost, against a measured install baseline

**Method**: `du` over the committed `build/` output from slice 1; `curl -sI` for candidate data.

| | Size | Install multiple |
|---|---|---|
| **Slice 1 install, as shipped** | **1.40 MB** (34 files; 865 KB is the SQLite WASM binary) | baseline |
| `Intl.Segmenter` | 0 bytes | **1.0×** |
| CC-CEDICT (`cedict_1_0_ts_utf-8_mdbg.txt.gz`) | 3.97 MB gzipped | ~3.8× |
| jieba frequency dictionary (`dict.txt`) | 5.07 MB raw | ~2.5–4.6× depending on trimming |
| Pyodide + jieba | far larger again (runtime plus package) | 10×+ |

**Decision**: ship `Intl.Segmenter` alone. Run the candidate comparison **laptop-side**, in a
committed script, and ship only the winner. Recorded in
[ADR-0012](../../docs/adr/0012-candidate-comparison-runs-laptop-side.md).

**Rationale**: `FR-026` requires a *recorded* comparison; it does not require an in-app one, and
`US3`'s independent test is satisfied by a report. Shipping three analyzers to answer a question once
would multiply a 1.40 MB install by four or more permanently, for a benefit that expires the moment
the question is answered. The constitution already sanctions laptop-side tooling as preserved option
3. This also keeps `FR-031`'s budget trivially satisfied: install size after this slice is unchanged.

**What this does not do**: it does not decide the outcome. If the comparison shows the built-in
segmenter losing badly, `SC-002` requires either adopting the winner or writing down why not — and
the written justification would then be the install multiple above, stated with its evidence.

---

## R6. The delimiter set, and why it is the language provider's

**Decision**: the segmentation unit is bounded by line breaks and CJK sentence-final punctuation, and
the delimiter set is a property of the **language provider**, not of a shared routine. Recorded in
[ADR-0013](../../docs/adr/0013-segmentation-unit-owned-by-language-provider.md).

**Rationale**: what can appear inside a word is a fact about a language. Chinese can exclude the
ASCII full stop safely, because there it lives inside numbers, abbreviations and URLs rather than
ending sentences. Dutch cannot: there the full stop *is* the terminator, and separating it from
abbreviations is a genuinely hard problem. A shared delimiter set would either be wrong for Chinese
or wrong for Dutch. Seam 1 already exists for exactly this kind of fact.

**Safety argument, and why it needs no cleverness**: the risk is asymmetric. A **missed** boundary
only widens the context the segmenter sees and is harmless. A **false** boundary can split a real
word. So delimiters are admitted only when they cannot occur inside a word, and doubt resolves
toward not splitting. Correctness does not rest on getting the set right by reasoning: units
reassemble into the source, so the whole-document tiling property (`FR-005`) fails loudly if the set
is ever wrong.

---

## R7. `isWordLike` versus the existing `isWord`

**Method**: inspect segment records from R1 and R2.

**Finding**: `Intl.Segmenter` reports `isWordLike` per segment, and it is honest — spaces and 。？ came
back `false`, Latin runs and digits came back `true`.

**Decision**: `isWord` MUST NOT be `isWordLike` passed through. It MUST remain "is this markable",
which for Chinese means Han script, as `character.ts` already decides with `/\p{Script=Han}/u`.

**Rationale**: obligation 3 of the analyzer contract says `isWord` is what keeps the word list free
of items that cannot be studied. `Python` and `3.14` are word-like and are not Chinese vocabulary.
Slice 0 already made this distinction correctly; the risk here is a plausible-looking simplification
that quietly starts polluting the word list. The two flags answer different questions.

---

## R8. The implementation, observed (added during `/speckit-implement`)

Recorded because ADR-0011 makes this a fact worth keeping rather than a debugging aside.

**Laptop fingerprint, Node 24.20.0 on Linux: `75323e0d`.** This is what `intl-segmenter-zh` stamps
documents with here. Task T047 compares the phone's against it. A difference is not a failure — it
is the case the fingerprint exists to handle — but it must be written down when observed.

Output through the real code path, not a scratch script:

```
我在中国学习中文。他骑自行车去上班。 -> 我在 | 中国 | 学习 | 中文 | ·。· | 他 | 骑 | 自行 | 车 | 去 | 上班 | ·。·
𠮷野家很好吃。                      -> 𠮷 | 野家 | 很好 | 吃 | ·。·
圆周率是3.14。                      -> 圆周 | 率 | 是 | ·3.14· | ·。·
```

Three things confirmed here that no property test asserts, because asserting them would encode one
ICU build's judgment (Principle II):

1. **Real words.** 中国, 学习, 中文, 上班 are single markable spans. The known weaknesses are present
   exactly as R1 measured them — 自行 + 车, and 我在 merged — and are not defects of this slice.
2. **The astral conversion works in situ.** 𠮷 comes back as one token rather than as a mangled
   surrogate half, which is the R2 failure reaching production code rather than a unit test.
3. **The delimiter exclusion works.** `3.14` survives intact and non-markable, so the ASCII full
   stop is genuinely not splitting decimals (ADR-0013).

## R9. What slice 2 actually cost to install (measured after implementation)

`FR-033` requires this to be measured rather than discovered on the phone, and `SC-008` requires it
recorded against slice 1's figures.

| | Files | Size |
|---|---|---|
| Slice 1, as shipped | 34 | 1.404 MB |
| Slice 2, as built | 36 | 1.409 MB |

**+5 KB, +0.35%.** Two new JavaScript chunks for the analyzer, and `Intl.Segmenter` itself costing
exactly what R5 predicted: nothing. The ceiling in `scripts/check-bundle.mjs` is 10%, so this is two
orders of magnitude inside it — which is the point of the ceiling, since the smallest candidate that
needs a dictionary would land at +140% or worse.

The budget is now a build gate rather than a remembered intention, and it was verified by making it
fail: a 3.8 MB file placed in `build/` produced a non-zero exit naming the offending file.

## R10. The laptop browser pass (T041)

Chrome 150.0.7871.181, headless, serving the real `BASE_PATH=/language-reader` build through
`vite preview`. One Chrome, targets opened and closed over CDP, every wait a poll against a
condition — the harness discipline slice 1 arrived at the hard way.

| Check | Result |
|---|---|
| Real words in the reader | **pass** — `我在 \| 中国 \| 学习 \| 中文 \| 他 \| 骑 \| 自行 \| 车 \| 去 \| 上班` |
| Analyzer stamp shown | **pass** — `Segmented by intl-segmenter-zh · 75323e0d` |
| Word-boundary gap applied (FR-012) | **pass** — computed `margin-right: 3.36px` |
| Service worker controlling the page | **pass**, manifest valid, 34 files precached |
| Installable | **pass** — the Install control was present, which slice 1 established as a live check: the browser only offers it when the app genuinely qualifies |
| Reading with the server stopped | **pass** — 10 word tokens rendered from cache |
| A copy without the lease refuses a change | **pass** — "cannot save right now" |

**Chrome's fingerprint here is `75323e0d`, identical to Node's.** That is mild evidence that the
ICU in Chrome 150 on this machine and the one in Node 24.20.0 agree, and it is *not* evidence about
Chrome on Android, which is a different ICU build on a different platform. T047 remains the check
that matters.

**One false failure, recorded because the pattern costs more than the bug.** The read-only check
failed twice before passing, and neither failure was a regression:

1. The first detector counted "a `/read/` link exists" as proof a save succeeded — but earlier
   scenarios had already saved documents, so it was true before the scenario began. Fixed by
   counting documents against a baseline taken immediately before the action.
2. The real cause was a missing **precondition**. `session()` is lazy, so a copy that has painted
   its controls has not necessarily asked for the storage lease yet. The background copy was
   legitimately still holding it, and its save legitimately succeeded. Fixed by polling until the
   foreground copy had demonstrably acquired storage before attempting the write.

Both are the same mistake in different clothes: asserting on a state that had not been established.
This is the third time on this project that a browser check reported a failure that was not there
(see [[browser-verification-harness]] in the developer's notes), and the thing that caught it was
polling for *either* outcome rather than only the hoped-for one — a harness that can only observe
failure cannot distinguish a regression from its own race.

**What this pass does not cover.** Re-derivation end to end in a browser: producing a genuinely
stale document requires building twice, and slice 1's explicit update control means the new version
does not activate until it is taken. Re-derivation is proven at the unit level against a real
SQLite database, and T048 is the check that exercises it through OPFS and the worker on a document
that has actually been sitting on the phone.

## R11. The phone answered the question, and the answer is no (2026-09-03)

**`Intl.Segmenter` does not segment Chinese into words on the target device.**

Observed on the reader's Android phone, from the installed application, after taking the update:

| | Fingerprint | Probe: 朋友很好，我在中国学习中文。 |
|---|---|---|
| Node 24.20.0, laptop | `75323e0d` | 朋友 / 很好 / 我在 / 中国 / 学习 / 中文 |
| Chrome 150, laptop | `75323e0d` | as above |
| **Chrome, Android** | **`7db96c05`** | **every character separate** |

**Cause.** ICU's word breaking for languages without spaces is dictionary-driven, and those
dictionaries — Chinese/Japanese, Thai, Khmer, Lao, Burmese — are roughly 2.9 MB of separable data
that a build can omit. A browser built without them still exposes `Intl.Segmenter`, still accepts
`granularity: 'word'`, and still returns an answer; the answer is character breaks. There is no
capability flag, and the API deliberately does not expose ICU's custom-dictionary support, so
nothing can be supplied to repair it from JavaScript.

**This is not a defect in the analyzer, the offsets, or re-derivation.** All of those did exactly
what they were built to do. The application faithfully reported what the platform told it.

**What it costs.** The entire basis for choosing `Intl.Segmenter` was that it is correct enough and
costs zero bytes (R1, R5). It is not correct on the device the constitution says is the oracle, so
the zero-cost option does not exist and the trade-off in R5 has to be made again with that column
removed.

**What it vindicates.** ADR-0011. A hand-written `version: "1"` would have stamped both devices
identically, and a library segmented two different ways would have accumulated silently with no
way to tell the halves apart. Instead the difference announced itself as a changed fingerprint the
first time the phone was looked at, and the documents on the phone are internally consistent — they
are stamped `7db96c05` and they really were segmented by whatever produces `7db96c05`.

**Proof, rather than inference.** The reader's first reading of this was that the analyzer simply
had not been deployed, which is the right thing to suspect and is checkable. The app's fingerprint
calculation was reproduced outside the app and validated against the known laptop value
(`75323e0d`) to show the reproduction was faithful; then the question was asked in reverse — what
hash results if the segmenter returns every character separately?

```
control — this machine:        75323e0d   (matches the app: reproduction is faithful)
hypothesis — per-character:    7db96c05
phone reported:                7db96c05
```

Identical. Two things follow and neither depends on judgement. The new code *did* reach the phone,
because fingerprints do not exist in the previous build — it displayed `v1` — so no old build could
produce that value, or any hash at all. And the analyzer ran and was handed single characters: the
probe is 50 characters, desktop Chrome returns 35 words from it, the phone returned 50 tokens.

**Consequence for SC-002.** The shipped analyzer is not the best candidate measured; on the target
device it is the worst possible one. Whatever ships next has to carry its dictionary, which makes
this the case ADR-0012 named in advance: *"Revisit if a candidate wins that needs its data shipped
regardless."*

## R12. What the reader's own word list does (2026-09-03)

Decided in [ADR-0014](../../docs/adr/0014-the-reader-carries-its-own-word-list.md): CC-CEDICT
headwords, greedy longest match, shipped with the application.

**Cost, measured.** 120,176 headwords: 1.002 MB on disk, **0.432 MB gzipped over the wire**. Whole
application 2.412 MB on disk, about **1.46 MB over the wire** against roughly 1.03 MB before. The
definitions are 3.97 MB gzipped and segmentation never reads them, so they are not shipped.

**Output, through the real code path in a browser over HTTP:**

```
朋友很好，我在中国学习中文。 -> 朋友 | 很 | 好 | ·，· | 我 | 在 | 中国 | 学习 | 中文 | ·。·
他骑自行车去上班。            -> 他 | 骑 | 自行车 | 去 | 上班 | ·。·
玛丽亚是我的朋友。            -> 玛丽亚 | 是 | 我 | 的 | 朋友 | ·。·
圆周率大约是3.14。            -> 圆周率 | 大约 | 是 | ·3.14。·
结婚的和尚未结婚的人。        -> 结婚 | 的 | 和尚 | 未 | 结婚 | 的 | 人 | ·。·
```

**Fixed, against the platform segmenter:** 朋友 (the case the reader reported), 自行车 whole rather
than 自行 + 车, 玛丽亚 whole rather than 玛丽 + 亚, and 我 / 在 as two words rather than 我在 merged
into a non-word.

**Not fixed, and one regression.** 三个人 still reads as 三 / 个人 — the same error, by a different
route. And 结婚的和尚未结婚的人 now falls into the 和尚 trap, which `Intl.Segmenter` got right:
greedy longest match is context-free, so it cannot weigh 和尚 against 和 + 尚未. Against the phone's
previous behaviour this is not a regression — every character was separate — but against desktop
`Intl.Segmenter` it is, and frequency weighting is the known fix at 1.62 MB gzipped. That is a
measurement for the harness, not an argument.

**Non-Han runs are grouped**, so `3.14` is one unmarkable token rather than four. It changes nothing
about the word list — none of it is markable — and it stops the reader reassembling numbers by eye.

**Verified in a browser, not only in tests:** real words over HTTP, the service worker controlling
the page, 35 files precached, and reading with the server stopped — which is what proves the word
list is genuinely on the device rather than a fetch away.

**One correction to R10.** That pass was run through `vite preview`, which mounts assets at `/`
while serving pages under the base path, so every asset 404s on a cold profile. R10's results were
real but survived that because the profile had a warm service worker cache from an earlier run.
Replaced with a static server that mounts the build under `/language-reader/` exactly as the host
does — which is what slice 1's quickstart already said to do, for exactly this class of reason.

## R13. The dictionary's ceiling, and what is above it (2026-09-03)

Reported from the phone: 你是那国人 came back as 你 · 是 · 那 · **国人**. Greedy longest match finds
国人 in CC-CEDICT at that position and takes it, stranding 那. The dictionary is right that 国人 is
a word and wrong that it is this word, and only the surrounding sentence decides.

**The cheap rung was measured before it was rejected.** The register held that frequency scoring is
"not the resolver" for context-dependent spans; that was tested rather than trusted:

```
你是哪国人        greedy: 你|是|哪|国人      frequency: 你|是|哪|国人     ← unchanged
三个人在那里等着   greedy: 三|个人|在|那里    frequency: 三个|人|在|那里    ← improved
结婚的和尚未…      greedy: …|和尚|未|…       frequency: …|和|尚未|…       ← fixed
```

So 1.6 MB of frequency data would fix 和尚, improve 三个人, and leave the reported case exactly as
wrong. The register was right about the principle and wrong about which cases follow from it.

**A contextual tagger fixes all three**, measured on the seven sentences this slice has argued
about. `bert-base-chinese-ws` int8 got all seven right; the dictionary gets four.

**Sizes, measured — and the register's estimate was wrong.** It expected a "tiny Chinese BERT,
4 layers, 256 hidden, roughly 10–30 MB". No published Chinese segmentation model is that shape.

| | Download | Correct of 7 | Note |
|---|---|---|---|
| Dictionary alone | 0.43 MB | 4 | wrong: 国人, 三个人, 和尚 |
| `albert-tiny-chinese-ws` int8 | 7.4 MB | 4 | fixes 国人, **breaks** 自行车 |
| `albert-tiny-chinese-ws` fp32 | 14.1 MB | 5 | fixes 国人, keeps 自行车 |
| `bert-tiny-chinese-ws` | 11–44 MB | 3 | breaks 结婚, invents 国学习 |
| **`bert-base-chinese-ws` int8** | **98 MB** \* | **7** | shipped, on demand |
| ONNX runtime (any) | 3.15 MB | — | in the build, not the install |

\* **Corrected after checking the host.** These download figures were first taken from gzipped
sizes measured locally. The model's host serves `.onnx` uncompressed — asked with
`Accept-Encoding: gzip` it returns 102,904,192 bytes and no `Content-Encoding` — so the model costs
about 98 MB rather than 74, and the whole capability about 100 MB rather than 79. Verified in a
browser: the combined download reported 111 MB against an uncompressed local runtime, which is the
same figure. The decision was made against the lower number; it survives the correction on quality
grounds, and the price is now the measured one.

Two findings inside that table are worth keeping. **Quantisation is not free**: int8 cost
albert-tiny the compound 自行车 that its fp32 form gets right, so the smaller file is no better than
the dictionary while costing seventeen times more. And **CKIP's models are trained on Traditional
Chinese**, which was flagged as a risk to verify; it did not materialise — all of them handle
Simplified correctly, because the underlying `bert-base-chinese` vocabulary covers both.

Decision and its consequences in
[ADR-0015](../../docs/adr/0015-a-contextual-model-fetched-on-demand.md).

**Two assumptions the build caught, recorded because both were wrong in writing.**

1. *"A dynamic import keeps the runtime out of the install."* It does not. Vite resolved
   `onnxruntime-web` to its bundled build and emitted the 26.5 MB **jsep** variant as a hashed
   asset, straight into the precache — an install twelve times larger than intended. Caught by the
   budget gate, not by inspection. Fixed with the documented `onnxruntime-web-use-extern-wasm`
   resolve condition plus the `./wasm` entry point.
2. *"Serving the runtime from our own origin is enough."* The runtime's loader is a `.mjs` file, and
   browsers enforce strict MIME checking on module scripts: served as `application/octet-stream` it
   is simply unloadable. Seen in local verification, where the model downloaded, stored, and
   switched the analyzer — stamp `bert-ws-zh · 1-8550a78c-q8` — and then the runtime would not
   load. The harness was at fault, but a host with the same MIME table would have failed
   identically in production, so the files are now named `.js`/`.wasm` and addressed by explicit
   URL rather than by directory prefix.

**Install cost is now defined as precached bytes rather than build bytes.** They were the same
thing until the runtime went into the build and deliberately out of the install. Counting the build
would report a cost nobody pays.

## Open questions carried into design

1. **Does Chrome on Android segment identically to Node here?** Unknown, and unknowable from this
   machine. R3's fingerprint makes it *safe* rather than *known*: if it differs, documents re-derive.
   The phone check should record the fingerprint observed on the device.
2. **Is pasted subtitle text a faithful stand-in for imported subtitles?** Carried from the spec
   checklist. It affects `FR-028`'s short-lines-versus-prose split only, and no content source in
   this slice produces real subtitle timing.
3. **Should the catch-up sweep report to the diagnostics page?** Left open by clarification as
   low-impact. Design leans yes, because slice 1 established diagnostics as where invisible work
   becomes visible, and the sweep is invisible work by definition.
