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
| Better segmenter than the current one | high | cheap | Derived data. `analyzer` + `analyzer_version` are recorded per document, so swapping is a recompute. Starting at pkuseg rather than jieba because segmentation quality is a known annoyance from LingQ, not a hypothetical one. | Defer (swap freely) |
| User segmentation corrections | high | **expensive** | **Earned data.** No segmenter can be right, because word-hood is undefined and the correct split is learner-dependent. Corrections are the actual fix, and they must survive re-segmentation — which they do, being anchored on character offsets. | **Built in slice 1** |
| User dictionary feeding the segmenter | medium | cheap | Additive word list; improves accuracy cheaply. Corrections can feed it. | Defer |
| LLM gloss / heteronym / re-segmentation enrichment | medium | cheap | Supplements the local segmenter and dictionary, never replaces them. Viable for short content — subtitles and transcripts, both rated high — where per-passage cost is trivial. System must work fully without it. | Defer |

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
| Word identity refinement (merge/split of lexemes) | high | cheap ↓ | **Decided** (ADR-0002, ADR-0005). **Promoted to slice 1** — no longer deferred. Correcting segmentation *is* merging and splitting adjacent tokens, so these are user-facing operations, not background machinery. Verified in Dafny, since ADR-0002's revisability claim depends on their correctness. | **Built in slice 1, verified** |
| Word-status history / statistics over time | high | **expensive** | Earned data. If only current status is stored, past transitions are unrecoverable — they were never written. No amount of retained input helps. | **Decided** — `status_event` log from first migration |
| Multiple users / accounts | medium | **expensive** | Adding a tenant key to populated earned tables. | **Decided** — `user_id` on earned tables, defaulted to one local user |
| Multi-span tokens (离合词 帮忙, Dutch *opbellen*) | medium | cheap | Derived data: tokens are recomputed from retained raw text, so this is a recompute rather than a migration. Cost of deferring is that separable verbs are mis-segmented in the interim. | Defer |
| Word-level notes or tags by the user | medium | **expensive** | Earned data — reclassified upward under ADR-0003. Cheap as an additive table, but the table must exist before notes are written or there is nothing to migrate from. | Hedge when first note feature lands |

## Product Surface

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Frequency / HSK-level word ordering | high | cheap | Additive reference data joined at read time, expressed as value + scheme. | Defer |
| Audio / TTS for words and sentences | high | cheap | Derived; additive field and a UI control. | Defer |
| Offline reading (PWA) | high | medium | Required by Principle I, so not deferred. Retrofitting offline onto an API-chatty client is real rework. | Respect from slice 1 |
| Character stroke order / handwriting | low | cheap | Isolated feature, additive reference data. | Defer |

---

## Resolved

**What is the identity relation on words?** Settled in [ADR-0002](adr/0002-word-identity-and-token-model.md).
The schema does not answer it: status attaches to a surrogate lexeme id, and the identity rule is
owned by the language provider. Chinese v1 uses the analyzer's surface form unnormalized —
看看 ≠ 看, 北大 ≠ 北京大学, and heteronyms share a lexeme. Dutch will later use lemmas without a
migration.

## Open

**Does over-counting become annoying in practice?** Chinese v1 treats reduplications and
abbreviations as distinct words. The honest test is whether the known-word count feels wrong
after a few weeks of real reading. Note this is no longer a trigger for *building* merge — merge
ships in slice 1 for segmentation correction — but for deciding whether the Chinese provider
should normalize them automatically rather than leaving it to manual correction.

**Is manual correction enough, or does the segmenter need replacing?** Slice 1 ships pkuseg plus
correction. If corrections are frequent enough to be tedious, that is the signal to add the user
dictionary or the LLM tier. Neither is a migration, so waiting for the evidence costs nothing.
