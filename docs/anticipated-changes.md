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
| Split heteronyms (长 cháng vs zhǎng) into distinct lexemes | medium | cheap | Lexeme split driven by token pronunciations already recorded at ingest, plus one nullable discriminator column. | Defer |
| Better segmenter than the current one | high | cheap | Derived data. `analyzer` + `analyzer_version` are recorded per document, so swapping is a recompute. Starting at pkuseg rather than jieba because segmentation quality is a known annoyance from LingQ, not a hypothetical one. **See the open question on `Intl.Segmenter` below — the choice of segmenter may not be a Python question at all.** | Defer (swap freely) |
| Vocabulary-overlay segmentation (known words win over the dictionary) | high | cheap | Derived. Layer the learner's own known terms over the segmenter's output by greedy longest match, so a word being studied is never split. Borrowed from Sapling. Complements manual correction and is self-improving: correcting once fixes every later occurrence everywhere. | **Consider for slice 1** |
| TTS segmentation disagreeing with reader segmentation | medium | cheap | jieba is a **global** singleton and the Kokoro front-end (misaki) follows it, so a reader segmenting with pkuseg and a TTS path segmenting with jieba will disagree within one sentence. `sentencegen/tts.py` already solves this generically by nudging jieba toward a target segmentation, gated on the words concatenating back to the sentence exactly. The reader's segmentation is therefore an *input* to TTS, not an independent choice. | Defer (solution known) |
| User segmentation corrections | high | **expensive** | **Earned data.** No segmenter can be right, because word-hood is undefined and the correct split is learner-dependent. Corrections are the actual fix, and they must survive re-segmentation — which they do, being anchored on character offsets. | **Built in slice 1** |
| User dictionary feeding the segmenter | medium | cheap | Additive word list; improves accuracy cheaply. Corrections can feed it. | Defer |
| LLM gloss / heteronym / re-segmentation enrichment | medium | cheap | Supplements the local segmenter and dictionary, never replaces them. Viable for short content — subtitles and transcripts, both rated high — where per-passage cost is trivial. System must work fully without it. | Defer |
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
| Anki sync client replacing `.apkg` export | high | cheap | Second implementation behind the export seam. | Defer |
| Import known words FROM the existing Anki collection | medium | **expensive** | Earned data from an external system of record. Needs a provenance marker distinguishing imported status from status earned in-app; retrofitting it means backfilling every row with a guess. | **Decided** — `provenance` column from first migration |
| Non-Anki SRS target | low | cheap | The export seam covers this. | Defer |
| Cloze / sentence cards rather than word cards | low | cheap | Different payload construction at the export boundary. | Defer |

## Data Model

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Word identity refinement (merge/split of lexemes) | high | cheap ↓ | **Decided** (ADR-0002, ADR-0005). Correcting segmentation *is* merging and splitting adjacent tokens, so these are user-facing operations, not background machinery. Verified in Dafny, since ADR-0002's revisability claim depends on their correctness. | **Built in slice 2, verified** |
| Word-status history over time | high | **expensive** | Earned data. If only current status is stored, past transitions are unrecoverable — they were never written. No amount of retained input helps. | **Decided** — `status_event` log from first migration |
| Per-word encounter statistics (counts, first/last seen) | high | **cheap** — but see the row below | **Derived**, provided the events they fold over exist. Every statistic is a fold over `status_event` and `reading_session`; adding a new one later is a new fold, not a migration. Do not decide now which statistics are wanted. | Defer entirely |
| Recording that a word was encountered | high | **expensive** | **Earned.** No fold recovers an encounter that was never written. Recorded as `reading_session(document_id, from_offset, to_offset, at, user_id)` — a few rows per session — and NOT as one event per token render, which would produce millions of rows and freeze statistics against a segmentation that is going to change. Encounters are then derived by intersecting sessions with tokens, so re-segmenting retroactively corrects history. | **Built in slice 1**, with the reader |
| Colouring words by statistic rather than status | medium | cheap | Pure presentation over derived data. Worth trying as intensity *within* a status colour rather than a second dimension; status colouring is already visually busy. | Defer |
| Multiple users / accounts | medium | **expensive** | Adding a tenant key to populated earned tables. | **Decided** — `user_id` on earned tables, defaulted to one local user |
| Multi-span tokens (离合词 帮忙, Dutch *opbellen*) | medium | cheap | Derived data: tokens are recomputed from retained raw text, so this is a recompute rather than a migration. Cost of deferring is that separable verbs are mis-segmented in the interim. | Defer |
| Word-level notes or tags by the user | medium | **expensive** | Earned data — reclassified upward under ADR-0003. Cheap as an additive table, but the table must exist before notes are written or there is nothing to migrate from. | Hedge when first note feature lands |

## Product Surface

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Frequency / HSK-level word ordering | high | cheap | Additive reference data joined at read time, expressed as value + scheme. | Defer |
| TTS for words and sentences | high | cheap | Derived. **Already solved** in the developer's `sentencegen` project: Kokoro v1.1-zh server-side in Python, to a standard already vetted against Google TTS. No browser model download is needed — see Borrowed Approaches for the three load-bearing details. | Defer (approach known) |
| Audio content with synced text (listen while reading) | high | cheap | Distinct from TTS: playing authentic recordings with the text following along. Derived, given the media file and its cues are retained. The developer listens more than they read, so this is closer to essential than the rating suggests. | **Slice 3** |
| Speech-to-text for audio without a transcript | medium | cheap | Content source. Lower priority than it looks: subtitles and YouTube transcripts both rate high and arrive *with* text. If a transcript is produced by STT it is derived and **the audio is the retained input** — keeping only the transcript forfeits re-deriving it with a better model, the same trap as discarding source text. | Defer |
| Offline reading (PWA) | high | medium | Required by Principle I, so not deferred. Retrofitting offline onto an API-chatty client is real rework. | Respect from slice 1 |
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
  distinguish. Reached independently of ADR-0002 and arriving at the same place; useful as the
  known destination for our deferred heteronym split.
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

## Open

**Should segmentation happen in the browser rather than on the server?** `Intl.Segmenter` removes
the premise that Python is forced — segmentation, the reason the backend exists, may not need a
backend. That would make offline reading trivial (currently an unresolved tension: the
constitution requires it while the architecture is a server API), remove pkuseg, and dissolve the
jieba/TTS coupling above. Against it: ICU quality is likely below pkuseg, and a server is still
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
