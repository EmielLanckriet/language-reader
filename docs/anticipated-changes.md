# Anticipated Changes Register

Governed by Constitution Principle V and [ADR-0001](adr/0001-seam-placement-policy.md).

This is the input to seam placement. Nothing structural gets built that is not traceable to an
entry here, and no entry licenses structure unless both filters agree.

## How to read this

Each entry carries two ratings:

- **Plausibility** — how likely is it that this is actually built? `high` / `medium` / `low`.
  This is a judgment only the developer can make. It is a bet, and it is revised as the project
  learns.
- **Retrofit cost** — what deferring would cost. `expensive` if it would later require migrating
  populated tables, changing a persisted identifier, or changing a contract an external system
  depends on. `cheap` if it would cost only a mechanical code refactor. Ambiguous cases are
  rated `cheap` by rule.

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

## Content Sources

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Subtitle (.srt/.vtt) import | high | cheap | New implementation of the ingestion interface, plus timing metadata as additive columns. | Defer |
| YouTube transcripts | high | cheap | Ingestion implementation plus a fetch step. | Defer |
| Video playback with synced subtitles | high | cheap | Largely a new UI surface. Timing data is retained at ingest under the Principle V retention rule, so nothing is lost by deferring. | Defer |
| EPUB import | medium | cheap | As above. Anchoring is already settled — see reading position. | Defer |
| Reading position / progress per document | high | — | **Decided** (ADR-0002): anchors on character offsets into retained raw text, never token indices. Re-segmentation is inevitable in Chinese, so token indices are unstable. | Built in slice 1 |

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
| Word identity refinement (merge/split of lexemes) | high | cheap ↓ | **Decided** (ADR-0002). Was the one-way door of this project; is now a reversible merge/split because status attaches to a surrogate id. Merge and split operations must still be built and tested — they are the mechanism this depends on. | Defer, but test early |
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
after a few weeks of real reading. This is the trigger for building lexeme merge.
