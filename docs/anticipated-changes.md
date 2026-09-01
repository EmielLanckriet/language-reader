# Anticipated Changes Register

Governed by Constitution Principle V and [ADR-0001](adr/0001-seam-placement-policy.md).

This is the input to seam placement. Nothing structural gets built that is not traceable to an
entry here, and no entry licenses structure unless both filters agree.

## How to read this

Each entry carries two ratings:

- **Plausibility** — how likely is it that this is actually built? `high` / `medium` / `low`.
  This is a judgment only the developer can make. It is a bet, and it is revised as the project
  learns.
- **Retrofit cost** — what deferring would cost, judged on the earned/derived classification
  (Constitution Principle V, [ADR-0003](adr/0003-earned-versus-derived-data.md)) rather than on
  whether the data is persisted. `expensive` if the data is **earned** — produced by the user or
  an irreproducible external process, and recoverable from nothing the system retains. `cheap` if
  it is **derived** — recomputable from preserved inputs, and therefore a recompute rather than a
  migration. Code structure is always `cheap`. Ambiguous cases are rated `cheap` by rule.
  Derived data stays cheap only while its inputs are retained.

They combine into an action:

| | expensive | cheap |
|---|---|---|
| **high / medium** | **Seam now** | **Defer** (record only) |
| **low** | **Hedge schema** | **Ignore** |

Revising a plausibility rating upward into the "Seam now" cell is a trigger for planning work,
not a silent edit.

## Status

Plausibility ratings are the developer's. Retrofit costs are reassessed after
[ADR-0002](adr/0002-word-identity-and-token-model.md) and
[ADR-0003](adr/0003-earned-versus-derived-data.md); several entries dropped from `expensive` to
`cheap` because word status now attaches to a surrogate lexeme id rather than to a string, and
because derived data is cheap to change regardless of size. Entries marked **Decided** are
settled in an ADR and no longer open questions.

---

## Languages

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Japanese support | low | cheap | Third implementation behind an interface that already has two. Pure code. | Defer |
| Korean support | low | cheap | Same as above. | Defer |
| Traditional Chinese alongside Simplified | low | cheap ↓ | Reclassified as orthographic variation, not a Chinese quirk (Dutch spelling reforms are the same phenomenon). Simplified→traditional is many-to-one, so it is a lexeme merge — tractable now that identity is a surrogate id. | Defer |
| Per-language word-identity rules | medium | cheap ↓ | **Decided** (ADR-0002): the identity rule is owned by the language provider, not the schema. Adding Dutch lemma identity needs no migration. | Defer |
| Split heteronyms (长 cháng vs zhǎng) into distinct lexemes | medium | cheap | Lexeme split driven by token pronunciations already recorded at ingest, plus one nullable discriminator column. Handles differing readings only. | Defer |
| Separate homographs that share a reading (花 huā flower / to spend) | medium | **open problem** | Recorded pronunciation carries no signal here, so the mechanism planned for heteronyms does not apply. Needs a sense discriminator supplied by the learner or a model. Confirmed unsolved in Sapling by its author. **Not a deferred decision — an unsolved one.** Surrogate lexeme ids keep every option open, which is the whole reason ADR-0002 declined to add a pronunciation-shaped discriminator early. | Keep options open; do not design for it yet |
| Recording which occurrence a status judgment was about | high | **expensive** (earned) | Not designing for the open problem above — *retaining the evidence any solution to it would need*. Pronunciation carries no signal for same-reading homographs, but the **sentence being read does**: 花 in 一朵花 and in 花钱 are told apart by context and nothing else. Store `document_id`, `from_offset`, `to_offset` and `observed_pronunciation` on `status_event`, all nullable, anchored on character offsets so they survive re-segmentation. Without it, a judgment is "marked 花 known at time T" with no context, and any later sense split — by learner or by model — has nothing to adjudicate on. This is ADR-0003's preserve-the-inputs corollary applied to judgments rather than to text. **LIVE HEDGE.** | **Built in slice 1** |
| Better segmenter than the current one | high | cheap | Derived data. `analyzer` + `analyzer_version` are recorded per document, so swapping is a recompute. Starting at pkuseg rather than jieba because segmentation quality is a known annoyance from LingQ, not a hypothetical one. **See the open question on `Intl.Segmenter` below — the choice of segmenter may not be a Python question at all.** | Defer (swap freely) |
| Vocabulary-overlay segmentation (known words win over the dictionary) | high | cheap | Derived. Layer the learner's own known terms over the segmenter's output by greedy longest match, so a word being studied is never split. Borrowed from Sapling. Complements manual correction and is self-improving: correcting once fixes every later occurrence everywhere. | **Consider for slice 1** |
| TTS segmentation disagreeing with reader segmentation | medium | cheap | jieba is a **global** singleton and the Kokoro front-end (misaki) follows it, so a reader segmenting with pkuseg and a TTS path segmenting with jieba will disagree within one sentence. `sentencegen/tts.py` already solves this generically by nudging jieba toward a target segmentation, gated on the words concatenating back to the sentence exactly. The reader's segmentation is therefore an *input* to TTS, not an independent choice. | Defer (solution known) |
| User segmentation corrections | high | **expensive** | **Earned data.** No segmenter can be right, because word-hood is undefined and the correct split is learner-dependent. Corrections are the actual fix, and they must survive re-segmentation — which they do, being anchored on character offsets. | **Built in slice 1** |
| User dictionary feeding the segmenter | medium | cheap | Additive word list; improves accuracy cheaply. Corrections can feed it. | Defer |
| LLM as a **joint** analyzer: segmentation, reading and contextual gloss in one pass | high | cheap | **Re-framed and promoted.** Its value is not better glossing but that it is *joint*: a pipeline commits to a segmentation using information the gloss step no longer has, and a split of 花钱 into 花 + 钱 cannot be repaired downstream because there is no 花钱 left to reason about. One pass that sees the whole sentence has no such propagation. No classical tool offers this — joint segmentation + POS is standard, joint segmentation + *sense* is not, because sense inventories are not agreed. An LLM needs no inventory since it writes the gloss. For short content (subtitles, transcripts — both rated high) it is plausibly the **primary** analyzer, not a supplement; cost, latency and offline keep the local segmenter primary for bulk text. Architecturally free: just another named analyzer with a version, its gloss derived annotation on the token. | Defer; **reconsider ordering at slice 1** |
| Local LLM rather than an API for enrichment | medium | cheap | The developer already runs Qwen3-4B-Instruct via `llama_cpp` in `sentencegen`. Free, offline, no key. Honest caveat: a 4B model produces weaker context-appropriate glosses than a frontier model, and glossing is the task where quality is the entire value. Worth measuring rather than assuming either way. | Defer |

## Content Sources

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Subtitle (.srt/.vtt) import | high | cheap | New implementation of the ingestion interface, plus timing metadata as additive columns. | Defer |
| YouTube transcripts | high | cheap | Ingestion implementation plus a fetch step. | Defer |
| Video playback with synced subtitles | high | cheap | Largely a new UI surface. Timing data is retained at ingest under the Principle V retention rule, so nothing is lost by deferring. | Defer |
| EPUB import | medium | cheap | As above. Anchoring is already settled — see reading position. | Defer |
| Reading position / progress per document | high | — | **Decided** (ADR-0002): anchors on character offsets into retained raw text, never token indices. Re-segmentation is inevitable in Chinese, so token indices are unstable. | Built in slice 1 |
| Webpage overlay preserving original layout | medium | **expensive** if unhedged | Tokens must map into HTML rather than plain text. If the document model assumes `raw_text` is plain text, HTML documents do not fit and every stored document needs touching. Delivered on phone by a server-side proxy, not an extension. | **Decided** — `raw_content` + `content_type` from first migration |

## SRS and Export

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Anki `.apkg` export | high | medium ↑ | **Re-rated under ADR-0007.** genanki is Python, and there is no Python in the browser, so building an `.apkg` client-side needs a JavaScript writer for Anki's format — real work, and a format that is not trivial. Two cheaper routes: export a plain word list the laptop turns into a deck, or run the export through Pyodide. Not a data problem; the export seam is unaffected. | Defer; decide route at slice 4 |
| Anki sync client replacing `.apkg` export | medium ↓ | cheap | Second implementation behind the export seam. Harder without a server, since sync needs credentials and a network client; the laptop route sidesteps it entirely. | Defer |
| Import known words FROM the existing Anki collection | medium | **expensive** | Earned data from an external system of record. Needs a provenance marker distinguishing imported status from status earned in-app; retrofitting it means backfilling every row with a guess. | **Decided** — `provenance` column from first migration |
| Non-Anki SRS target | low | cheap | The export seam covers this. | Defer |
| Build our own FSRS scheduler instead of exporting to Anki | medium | cheap | `py-fsrs`/`ts-fsrs` make the algorithm a library, so this is a build decision, not a data one — **and it is already hedged**: `status_event` and `reading_session` are exactly the history a scheduler would need to start from, so choosing this later costs no lost data. The real risk is not technical: keeping Anki for years of tuned history while also reviewing in the reader means **two review queues and neither has the full picture**, which is worse than either alone. Migrating fully means giving up AnkiDroid's review UI and `sentencegen`'s nightly enrichment, and building a review app instead of a reading app. Arrives naturally at slice 4, by which point months of real use will have shown whether the export step is friction or fine. | **Decide at slice 4** |
| Cloze / sentence cards rather than word cards | low | cheap | Different payload construction at the export boundary. | Defer |

## Data Model

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Word identity refinement (merge/split of lexemes) | high | cheap ↓ | **Decided** (ADR-0002, ADR-0005). Correcting segmentation *is* merging and splitting adjacent tokens, so these are user-facing operations, not background machinery. Verified in Dafny, since ADR-0002's revisability claim depends on their correctness. | **Built in slice 2, verified** |
| Word-status history over time | high | **expensive** | Earned data. If only current status is stored, past transitions are unrecoverable — they were never written. No amount of retained input helps. | **Decided** — `status_event` log from first migration |
| Per-word encounter statistics (counts, first/last seen) | high | **cheap** — but see the row below | **Derived**, provided the events they fold over exist. Every statistic is a fold over `status_event` and `reading_session`; adding a new one later is a new fold, not a migration. Do not decide now which statistics are wanted. | Defer entirely |
| Recording that a word was encountered | high | **expensive** | **Earned.** No fold recovers an encounter that was never written. Recorded as `reading_session(document_id, from_offset, to_offset, at, user_id)` — a few rows per session — and NOT as one event per token render, which would produce millions of rows and freeze statistics against a segmentation that is going to change. Encounters are then derived by intersecting sessions with tokens, so re-segmenting retroactively corrects history. | **Built in slice 1**, with the reader |
| Colouring words by statistic rather than status | medium | cheap | Pure presentation over derived data. Worth trying as intensity *within* a status colour rather than a second dimension; status colouring is already visually busy. | Defer |
| Multiple **devices** for one reader | high ↑ | **expensive** (earned) | **Reframed under ADR-0007.** With data on the device, the realistic need is one reader on a phone and a laptop, not several people. Merging two histories requires knowing which device produced each entry and in what order — neither reconstructable afterwards — so entries carry a device identity and a per-device counter from the first version. A wall clock alone cannot do it: two devices disagree and nothing records by how much. | **Decided** — `device_id` + per-device counter on every history entry |
| Multiple people | low ↓ | **expensive** (earned) | Structurally covered by the owner column, which stays. No interface is planned, and with data on the device the case barely arises. | **Decided** — `user_id` retained, defaulted to one local reader |
| Multi-span tokens (离合词 帮忙, Dutch *opbellen*) | medium | cheap | Derived data: tokens are recomputed from retained raw text, so this is a recompute rather than a migration. Cost of deferring is that separable verbs are mis-segmented in the interim. | Defer |
| Word-level notes or tags by the user | medium | **expensive** | Earned data — reclassified upward under ADR-0003. Cheap as an additive table, but the table must exist before notes are written or there is nothing to migrate from. | Hedge when first note feature lands |

## Product Surface

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Frequency / HSK-level word ordering | high | cheap | Additive reference data joined at read time, expressed as value + scheme. | Defer |
| TTS for words and sentences | high | cheap | Derived. **Already solved** in the developer's `sentencegen` project: Kokoro v1.1-zh server-side in Python, to a standard already vetted against Google TTS. No browser model download is needed — see Borrowed Approaches for the three load-bearing details. | Defer (approach known) |
| Audio content with synced text (listen while reading) | high | cheap | Distinct from TTS: playing authentic recordings with the text following along. Derived, given the media file and its cues are retained. The developer listens more than they read, so this is closer to essential than the rating suggests. | **Slice 3** |
| Speech-to-text for audio without a transcript | medium | cheap | Content source. Lower priority than it looks: subtitles and YouTube transcripts both rate high and arrive *with* text. If a transcript is produced by STT it is derived and **the audio is the retained input** — keeping only the transcript forfeits re-deriving it with a better model, the same trap as discarding source text. | Defer |
| Offline reading (PWA) | high | medium | **Not negotiable.** It is in the constitution because the developer requires it, not as an aspiration to be traded away later. Retrofitting offline onto an API-chatty client is real rework, so the API shape must serve it from slice 1. Reading offline implies *marking* offline, which implies queued writes and merge — and the append-only `status_event` log is already the right structure for that, since append-only logs merge without conflict resolution. The hedge built for history turns out to be the offline mechanism too. | **Architecture constraint from slice 1** |
| Character stroke order / handwriting | low | cheap | Isolated feature, additive reference data. | Defer |

---

## Resolved

**What is the identity relation on words?** Settled in [ADR-0002](adr/0002-word-identity-and-token-model.md).
The schema does not answer it: status attaches to a surrogate lexeme id, and the identity rule is
owned by the language provider. Chinese v1 uses the analyzer's surface form unnormalized —
看看 ≠ 看, 北大 ≠ 北京大学, and heteronyms share a lexeme. Dutch will later use lemmas without a
migration.

## Decided: Slice 0's Database Is Disposable

Slice 0 uses a per-character dummy segmenter, so its lexemes are mostly single characters and its
word statuses attach to the wrong units. That data is explicitly disposable and may be wiped
before slice 1.

Every hedge is still built in slice 0 — `provenance`, `user_id`, `status_event`,
`raw_content` + `content_type`, surrogate lexeme ids, character-offset anchoring — because they
cost almost nothing and because slice 0's schema then *is* the real schema, so slice 1 is not
also a migration slice.

What changes is the stakes, not the work: a mistake in slice 0's schema shape is corrected by
wiping rather than by migrating. This exemption expires when slice 1 ships, at which point word
status becomes earned data in the full sense.

## Borrowed Approaches

Studied in other projects so they are not reinvented. Reading these is not a dependency on them.

**From [Sapling](https://github.com/Danacus/sapling)** (Danacus; TypeScript/Svelte, local-first,
no licence file so nothing may be copied verbatim without asking):

- **`Intl.Segmenter` segments Chinese in the browser**, using ICU's own dictionaries, built into
  every current browser and Node 22, with nothing to download. Imperfect — it prefers 自行 + 车 to
  自行车 — but free and serverless. See the open question below.
- **Vocabulary overlay by greedy longest match.** ICU decides the spans nobody claimed; the
  learner's own terms override it wherever they have an opinion. Neither half works alone: the
  dictionary alone splits words being studied, and terms alone leave unstudied words as loose
  characters.
- **Two keys, not one, for word identity.** `termKey` answers "same spelling?", `readingKey`
  answers "same reading?", and their pair identifies a card — with tones never folded, since
  tone is the whole difference between the two 长s. A reading-*less* entry deliberately collides
  with every spelling of itself, because a bare 长 is a claim about spelling with nothing in it to
  distinguish.

  **This is not a solved problem, per the author directly.** It resolves *heteronyms* — same
  spelling, different reading — and cannot touch homographs that share a reading: 花 huā is *flower* and
  *to spend*, 会 huì is *can* and *meeting*. `cardKey` returns one string for both, so they
  collapse into one entry. Separating those needs a **sense** discriminator, which means the
  learner's judgment or a model's gloss, neither cheap nor reliable. Treat this as an open
  problem, not a destination.

  A second failure sits alongside it, worth knowing before adopting the vocabulary overlay:
  even where a reading *would* disambiguate, the pipeline cannot use it. Identifying which 长 an
  occurrence is needs its reading; the reading in context needs the segmentation; segmenting well
  wants to favour known words; and known words are keyed by spelling **plus** reading, which does
  not exist yet. Their `annotate.ts` keys status by `cardKey`, but the overlay in `tokenize.ts`
  can only match on spelling. Any ordering of that pipeline gets one step wrong, so the overlay
  is inherently reading-blind — an acceptable cost, but not a fixable one.
- **Subtitle-following rules**, each a bug we would otherwise have shipped: a gap stays on the
  last line that *started* (cues do not tile a recording, and blinking off between every pair
  would flicker through a conversation); `start` is inclusive; a sentence with no timings is
  skipped rather than landed on; before the first timed sentence the answer is "no line", not
  line 0.
- **The concatenation invariant** — reassembling tokens reproduces the input exactly — and an
  `isWord` flag separating word-like segments from punctuation. Both match decisions already made
  here (FR-005, and the assumption that punctuation is tiled but not markable), which is
  reassuring rather than new.

**From `sentencegen`** (the developer's own; see [ADR-0006](adr/0006-anki-integration-boundary.md)
for why the projects stay independent): the AnkiDroid write constraints, the sync-down-first
rule, backup-before-write, refuse-while-desktop-holds-the-lock, prune-and-await-media. And three
load-bearing Kokoro details, each of which caused a silent bug: misaki rather than espeak (whose
Mandarin has stress but no tone), `ZHG2P(version="1.1")` with the matching 171-symbol vocabulary
(the tokenizer silently *drops* unknown symbols, so a v1.0 front-end deletes every Chinese
symbol), and reconciling jieba's segmentation so fused compounds are not rushed.

## Decided: Prefer Local Computation, Ideally On-Device

Where two designs both work, prefer the one that computes closer to the reader: on the phone over
the server, on the server over a third-party service. The application is deployed rather than run
from a laptop because the reader is a **phone user who needs it available**, not because
server-side computation is preferred — a distinction that had been recorded backwards and was
being used as an argument against local approaches.

"Where feasible" is doing real work in that sentence: an LLM analyzer cannot run on a phone, and
that is a reason to run it elsewhere, not a reason to abandon the preference. What the preference
decides is the ties — and it tilts the open browser-segmentation question below toward
`Intl.Segmenter`, which computes on the device and needs no round trip.

This is a preference ordering rather than a rule, but it is written down for the reason ADR-0004
gives: an unwritten preference is traded away silently whenever something else is locally
convenient.

**Largely settled by [ADR-0007](adr/0007-no-server-browser-first.md)**: there is no server, so
computation is local by construction. The preference now decides narrower questions — whether to
add Pyodide, whether to call an LLM — rather than the architecture. It may still warrant a
constitutional principle; that remains an open decision.

## Decided: Ensemble Segmentation, Escalating On Disagreement

Run several cheap local segmenters over the same text. Where they **agree**, accept the result.
Where they **disagree**, that span is flagged: the disagreement is a free, local, reliable signal
of exactly where segmentation is hard.

**Why this beats a single better model, and what it fixes.** Hybrid analysis could resolve a
word's reading or sense but could not repair a wrong *boundary*: a locally mis-split 花钱 is gone
before anything flags it, so no later step can ask about it. An ensemble does not lose it — one
segmenter emitted 花钱 and another emitted 花 + 钱, so both candidates are in hand and the
disagreement is itself the flag. This is the fix to a gap previously recorded as unfixable.

**Three sources exist already, at no additional cost:**

1. `Intl.Segmenter` — ICU's dictionaries, built into the browser.
2. **CC-CEDICT longest-match** — the dictionary is shipped for glosses regardless, so using it as
   a second opinion is free.
3. **The reader's own known words** — the vocabulary overlay, which improves as they read.

A fourth is better than Pyodide and should be preferred: **a frequency-scored maximum-probability
path over a Chinese word dictionary, implemented in JavaScript**. This is what jieba actually is —
build a graph of every dictionary match, then find the highest-probability path through it using
word frequencies. The valuable asset is the frequency dictionary (a few megabytes of data), not
the code, and the graph-and-scoring dynamic program is well understood. It costs no model, no GPU,
no WASM runtime, and works offline and instantly.

It is also the **diverse** opinion the ensemble is missing: `Intl.Segmenter` and longest-match are
both dictionary-driven and fail together, whereas a probabilistic max-path is a genuinely
different algorithm. Reimplementing all of jieba, HMM for unknown words included, is real work;
the scoring path is not, and is where most of the quality lives.

**jieba via Pyodide** remains available if that proves insufficient. Confirmed: jieba is pure
Python and works; **pkuseg does not** — it publishes platform wheels with compiled extensions and
would need an emscripten build plus its model files.

**Correction: frequency scoring does not resolve disagreements.** A maximum-probability path over
word frequencies is *context-free* — it returns the same answer for a character sequence wherever
it appears. But segmenters disagree precisely **because** a span is context-dependent
(结婚的和尚未结婚的 splitting as 和尚 / 未 or 和 / 尚未), so the disagreement set is enriched for
exactly the cases frequency cannot decide. Frequency scoring is still worth having as a diverse
ensemble member; it is not the resolver.

**The resolver should be a small sequence tagger, not a small LLM.** Chinese word segmentation is
character tagging, a narrow and long-studied task with strong small models. Two families fit on a
phone: a **BiLSTM-CRF character tagger** (embedding table plus a small recurrent net, contextual by
construction, order of 5–20 MB), or a **tiny Chinese BERT** (4 layers, 256 hidden; roughly 10–30 MB
at int8). Either runs on CPU via ONNX Runtime Web or Transformers.js — **no WebGPU**, which matters
given mobile support. Both are two orders of magnitude smaller than Qwen3-4B.

For segmentation a small specialist likely **beats** a large generalist: LLMs are not particularly
good at CWS. This is the inverse of sense disambiguation, where size is the whole story.

*Honest cost*: a turnkey Chinese CWS model already exported to ONNX may exist, but that needs
verifying rather than assuming; the realistic path may be converting a PyTorch model or
fine-tuning a small encoder. Real work, and of a different kind from shipping a data file.

*Consequence to weigh first*: a contextual tagger this good would probably be the **primary**
segmenter, with `Intl.Segmenter` demoted to fallback — simplifying the ensemble rather than
extending it.

*What a tagger does and does not do:*

- **Recovers wrongly-split compounds** (自行车 read as 自行 + 车) — yes, and this is its strength.
  Dictionary methods fail on unknown words and context-dependent boundaries; a tagger is trained
  on exactly those.
- **Discontiguous words** (帮忙 as 帮了他一个忙, Dutch *opbellen*) — **no, structurally.** CWS
  taggers emit per-character begin/middle/end/single tags, a scheme that assumes contiguity by
  construction: no tag sequence can say that position 1 and position 6 are one word. Discontiguous
  words are outside the task definition, so model quality is irrelevant. Catching them needs
  dependency parsing (LTP, HanLP), a purpose-built detector, or an LLM. This is already the
  deferred multi-span case; nothing changes.
- **Inherits one corpus's segmentation standard.** PKU, MSR and CTB disagree on cases like 中国人
  deliberately. A trained model does not resolve word-hood's ambiguity — it picks a side and stops
  signalling that a choice was made. This is why the vocabulary overlay and manual correction
  still matter with a good tagger: they are how the reader's opinion overrides the corpus's. It
  also means the **choice of training corpus is a product decision**, not just a quality one.

**A small in-browser LLM remains the wrong tool.** The task that resists frequencies is *sense*
disambiguation — 花 flower against 花 to spend, where both
readings are identical and both common — and that is exactly where a 0.5B–1B model is confidently
wrong, on the only cases anyone would ask it about. A wrong gloss that is trusted is worse than no
gloss. WebLLM (WebGPU), wllama (llama.cpp in WebAssembly) and Transformers.js all exist and are
preserved as options; realistic costs are hundreds of megabytes to a gigabyte of download, patchy
mobile WebGPU support, and phone-tab memory limits. Not recommended now.

**The local model worth using is the one already owned**: Qwen3-4B on the laptop, in a different
quality class from anything that fits in a phone browser, free per call and needing no network.
An import step running there and handing the phone an analysed file is ADR-0007's preserved
option 3, and this is the strongest argument for it so far.

**Diversity matters more than count.** `Intl.Segmenter` and CC-CEDICT longest-match are both
dictionary-driven and will fail together on the same novel compounds, so their agreement is weaker
evidence than it appears. jieba's HMM treats unknown words differently, which is what would make
it a genuinely additional signal rather than a third vote from the same family. Count votes with
that in mind; do not treat unanimity among correlated sources as confidence.

**Ensembling detects; it does not resolve.** A flagged span still needs a resolver: the LLM when
online, the reader when correcting, or a heuristic — most sources agreeing, or longest match — when
neither is available.

**Send the LLM the candidates, not just the text.** Retained raw content means the whole sentence
is always available, so a flagged span goes out as *"here is the sentence; one segmenter says
花钱, another says 花 + 钱; which is right here?"* This is better than asking for a segmentation in
two ways. It is an easier task — choosing between two options beats producing one from scratch.
And it is **validatable**: an open-ended segmentation can hallucinate a tiling that does not
reproduce the input, which then has to be caught against FR-005 and somehow recovered from,
whereas a choice between candidates is constrained to options already known to tile correctly.
The failure mode disappears rather than being handled.

This gives the LLM two distinct roles, both worth keeping:

| Role | Cost | Ceiling | Safety |
|---|---|---|---|
| **Joint analyzer** — segments a whole passage | High | Higher: catches errors where every local segmenter agrees but is wrong | Output must be validated |
| **Disagreement resolver** — picks between candidates on flagged spans | Low | Bounded: no disagreement, no flag | Constrained to valid options |

The resolver is the everyday path; the joint analyzer earns its cost on short content such as
subtitle lines, where a whole passage is a few dozen characters.

**No server is involved in either.** The browser calls the API directly with the reader's own key,
pay-per-use rather than by subscription, so nothing can lapse — and if the key is absent or out of
credit the application still works on local segmentation alone. The key is held on the device,
MUST NOT appear in the repository, and MUST be excluded from the export file.

All of this is derived data over retained text, so it is recomputable and costs no schema.

## Decided: The Analyzer Is A User Choice, Per Document

Three modes, all implementations of the existing language-provider seam, each recorded as its own
`analyzer` name so switching is a recompute like any other analyzer change:

1. **Local segmenter only** — offline, instant, free. The fallback and the bulk-text default.
2. **LLM only** — joint segmentation, reading and gloss in one pass over the sentence. Best
   quality, no pipeline loss, but costly and online.
3. **Hybrid** — segment locally, then send only flagged spans to the LLM.

**Mode is chosen per document, not globally.** A subtitle file wants mode 2; a novel wants mode 1.
That is where the cost difference actually falls.

**What mode 3 does and does not fix.** It resolves the reading or sense of a correctly segmented
word. It **cannot fix wrong boundaries**: if the local pass splits 花钱 into 花 + 钱, the compound
is gone before anything is flagged, so nothing asks about it. Mode 3 therefore inherits the
pipeline loss for segmentation while escaping it for sense — a real gap from mode 2, not a small
one.

**Flag disagreement, not only known homographs.** Sending spans that contain a known 多音字
catches readings; sending spans where two cheap analyzers *disagree* — the segmenter against a
dictionary longest-match — catches boundary errors too, which is most of what mode 3 would
otherwise miss. Both detectors are local, offline and cheap: the polyphone set is a few hundred
characters and the other is a lookup.

**Interface consequence for slice 1.** A local segmenter is pure, instant and infallible; an LLM
analyzer is async, batched, costly and can fail part-way. The language-provider seam MUST
accommodate both, or the three modes will not fit behind one interface. Cheap to design in, and a
retrofit is code rather than data — but it needs deciding when the seam is first written, not
after.

No schema consequence: mode is the analyzer's identity, which `analyzer` + `analyzer_version`
already records, and the user's choice is configuration rather than earned data.

## Decided: Analysis Is Import-Time, Reading Is Render-Time

A document is analysed once, when imported: segmented, romanized and glossed by whichever
analyzer is configured. The output is stored as derived data. **Reading renders precomputed
tokens and runs no analyzer at all** — no model, no inference, no round trip.

This is the load-bearing rule for offline, and it holds whatever the analyzer is. What the phone
caches is the analyzer's *output*, never its machinery, so analyzer size and speed are absent
from the read path entirely. An LLM analyzer is therefore compatible with offline reading; an
on-device LLM is not needed and is ruled out — phone-sized models are weak at exactly the
disambiguation this is for, and Sapling's 439 MB TTS download shows what shipping a model to a
browser costs.

Consequences, each feeding the slice-1 offline ADR:

- **Glosses are computed for the whole document at import**, not on demand, or tapping a word
  offline would fail.
- **Importing offline needs a local analyzer.** Most sources are fetched and therefore online
  anyway; pasted text is the case wanting a fallback, and `Intl.Segmenter` is one that costs
  nothing to ship.
- **Segmentation corrections work offline** — merge and split are pure operations over stored
  tokens, needing no model. Another reason the verified kernel is dependency-free.
- The API must return retained raw content *and* tokens, so the client can hold everything
  reading needs and so the browser-versus-server question above stays open.

## Open

**How much homography does a reader actually have to resolve?** A flashcard scheduler suffers
badly from collapsing 花-flower with 花-to-spend: one schedule for two things learned separately.
A reader may not — "how many words do I know" tolerates sense-collapsing far better. The likely
answer is one lexeme per surface form, a gloss listing several senses, and manual splitting as an
escape hatch the learner triggers when a specific word bothers them. That may be correct rather
than a compromise, and it is cheap to test by reading. **Note the circularity that makes the
general problem hard**: segmentation depends on knowing which words exist, identity depends on
the reading, and the reading depends on segmentation.

**Heteronyms specifically are more tractable than the circularity suggests.** Google TTS reads
多音字 correctly, which is proof the resolution is solvable rather than merely hard — and a
TTS G2P front-end must resolve every polyphone to speak at all, so it *is* a source of
context-resolved readings. The developer's own stack already computes them: `sentencegen` uses
misaki's `ZHG2P` for Kokoro, chosen precisely because espeak's Mandarin carries stress but no
tone. None of this touches same-reading homographs, where audio is identical and therefore
carries no signal at all — which remains the open half.

**On same-reading homographs, three things narrow the problem without solving it.** First,
segmentation *dissolves* many instances rather than resolving them: if the analyzer emits 花钱 as
one token there is no ambiguous 花 left, so better multi-character coverage shrinks the problem by
making the compound the unit. Second, **POS tagging is a context-dependent signal we already
record** — 花-flower is a noun and 花-spend a verb, 会-meeting a noun and 会-can an auxiliary — and
ADR-0002 already requires `pos` + `pos_tagset` at ingest, so the signal is being stored before we
knew we wanted it for this. It fails where both senses share a POS (打 as a verb means a dozen
things). Third, an LLM given the sentence disambiguates better than any WSD system that needs a
sense inventory, and needs none itself because it just writes the gloss; this is the enrichment
tier already in the register, better justified than when it was added.

Full WSD's bottleneck is not the model but the **sense inventory** — Chinese sense resources have
patchy coverage and disagree — which is why the inventory-free options above are the practical
ones.

**On "by the time you have segmented, the context is gone."** True of the analyzer's own
reasoning, and the reason pipelines lose to joint models. Not true of this system's storage:
`raw_content` is retained verbatim and tokens are derived, so re-analysing with a better or joint
model is a recompute rather than a lost opportunity (ADR-0003). What cannot be repaired after the
fact is the pass the learner actually *reads with* — which is the argument for the joint LLM
analyzer above, and the same complaint about first-pass segmentation quality arriving from a
third direction.

**The likely resolution is sense *ranking*, not sense *splitting*.** What a reader wants on
tapping 花 is the right sense shown first, not two 花 entries in their word list. That is
presentation over derived data: no schema, no discriminator, no migration, and it degrades
gracefully, whereas a wrong split corrupts the word list. A flashcard scheduler would need the
split; a reader probably does not.

**~~Should segmentation happen in the browser rather than on the server?~~ Decided by
[ADR-0007](adr/0007-no-server-browser-first.md): in the browser, because there is no server.**
What remains open is narrower and is a *measurement*, not an argument: is `Intl.Segmenter`
materially worse than jieba on text this reader would actually read? If it is, and neither the
vocabulary overlay nor manual correction closes the gap, Pyodide brings jieba and pypinyin into
the browser at a one-off download cached after installation. The original framing follows.

**Superseded framing —** `Intl.Segmenter` removes
the premise that Python is forced — segmentation, the reason the backend exists, may not need a
backend, and it would dissolve the jieba/TTS coupling above.

**Corrected framing**: this was previously said to make offline reading "trivial". It does not,
because offline reading was never gated on the segmenter — see the import-time rule below.
Browser segmentation buys offline *importing* and less server dependency, which are real but
narrower. Against it: ICU quality is likely below pkuseg, and a server is still
wanted for cross-device data. This is an architectural fork, not a detail, and needs an ADR
before `/speckit-plan`.

**Does over-counting become annoying in practice?** Chinese v1 treats reduplications and
abbreviations as distinct words. The honest test is whether the known-word count feels wrong
after a few weeks of real reading. Note this is no longer a trigger for *building* merge — merge
ships in slice 1 for segmentation correction — but for deciding whether the Chinese provider
should normalize them automatically rather than leaving it to manual correction.

**Is manual correction enough, or does the segmenter need replacing?** Slice 1 ships pkuseg plus
correction. If corrections are frequent enough to be tedious, that is the signal to add the user
dictionary or the LLM tier. Neither is a migration, so waiting for the evidence costs nothing.

## What Slice 0 Revealed

Recorded at the end of slice 0 (T046). These are things the implementation taught that the plan did
not know, and that should change how slice 1 is approached.

**Persistent storage is probably not granted until the app is installed.**
`navigator.storage.persist()` is asked for at startup and its answer recorded. Chrome grants it
readily to an installed site and is much less willing before that. The register previously called
home-screen installability "nearly free" and scheduled it with offline caching; it is better
understood as **the thing that protects earned data from eviction**. Until it ships, a browser under
storage pressure may delete the reader's marks, and nothing will have visibly failed. This raises
installability's priority in slice 1 rather than changing its cost.

**The OPFS VFS choice is load-bearing and was nearly wrong.** The plain OPFS VFS needs a Worker and
COOP/COEP response headers, which a static host cannot set. The SAH-pool VFS
(`installOpfsSAHPoolVfs`) runs on the main thread and needs no headers, which is what makes
SQLite-in-the-browser compatible with free static hosting at all. It also takes an *exclusive lease*
on its files, so exactly one connection may exist per origin — which is why there is a single
session module rather than per-screen connections. Anything in slice 1 that wants a Worker (a
segmenter, an ONNX model) has to reckon with the database not being reachable from it.

**SQLite-WASM runs under Node, so storage is testable without a browser.** This was not assumed
during planning and it changes what is cheap: the schema, migrations, the append path and the
projection rebuild are all exercised in plain `vitest` against an in-memory database. Slice 1 should
assume the same for reading sessions and the dictionary rather than reaching for a browser harness.

**Lexemes are created at import time, not at marking time.** The `token` table's
`CHECK ((is_word = 1) = (lexeme_id IS NOT NULL))` means a document cannot be saved without resolving
every word token to a lexeme. This moved find-or-create into slice 0's US1 and it has a consequence
for slice 1: **re-segmenting an existing document is not only a token recompute, it creates
lexemes.** The character-lexemes slice 0 accumulated will be orphaned rather than migrated, which is
consistent with this slice's data being disposable — but the exemption expires when slice 1 ships,
and after that a re-segmentation needs a decided answer for what happens to marks on the old
lexemes. That is the first thing merge and split (slice 2) will be asked to do.

**The language provider owns word identity as a function, not as a convention.** FR-009 became
`Analyzer.lexemeKey(surface)`. The repository applies whatever it returns and holds no opinion.
The contract's obligations required this; its interface sketch omitted it. For Chinese in slice 0
it is the identity function, so when Dutch arrives wanting dictionary forms, that is one function
and no migration.

**GitHub Pages needs the shell published twice.** Pages serves its own 404 for any path it has no
file for, so a bookmarked `/read/3`, or a reload while reading, would never reach the app. Pages
does serve a repository's own `404.html`, from which the client router recovers. The build writes
the fallback under both names. Worth remembering when the export file and any deep-linked view
arrive.

**Toolchain notes.** Current SvelteKit has no `svelte.config.js` — adapter, `paths` and `prerender`
are arguments to the `sveltekit()` Vite plugin. Prettier's formatting pass rewrites every markdown
file it is allowed to touch, including the constitution, the ADRs and this register; `docs/`,
`specs/`, `.specify/` and `.claude/` are excluded from it deliberately, and that exclusion should
survive any tooling change.

