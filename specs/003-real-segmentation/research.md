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
