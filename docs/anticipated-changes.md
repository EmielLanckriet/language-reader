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

Retrofit costs below are assessed. **Plausibility ratings are unset** — marked `?` — and need to
be filled in before the first `/speckit-plan`. Actions are therefore provisional.

---

## Languages

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Japanese support | ? | cheap | Third implementation behind an interface that already has two. Pure code. | Defer |
| Korean support | ? | cheap | Same as above. | Defer |
| Traditional Chinese alongside Simplified | ? | **expensive** | Affects word identity. If simplified forms are persisted as the key, adding traditional means either duplicate entries for one word or a migration of every stored word row. | Seam/hedge now |
| Per-language word-identity rules | ? | **expensive** | See "Word identity" below — this is the same decision. | Seam now |

## Content Sources

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| EPUB import | ? | cheap | New implementation of the ingestion interface. Position/anchor model may need care if reading position is persisted. | Defer |
| Subtitle (.srt/.vtt) import | ? | cheap | As above, plus timing metadata — additive columns. | Defer |
| YouTube transcripts | ? | cheap | Ingestion implementation plus a fetch step. | Defer |
| Video playback with synced subtitles | ? | medium→cheap | Largely a new UI surface. Only expensive if timing data was discarded at ingest rather than stored. | Hedge: retain timing at ingest |
| Reading position / progress per document | ? | **expensive** | Requires a stable anchor into document text. If text is re-segmented later and anchors are offset-based, saved positions break. | Hedge schema |

## SRS and Export

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Anki sync client replacing `.apkg` export | ? | cheap | Second implementation behind the export seam, which already exists per Principle V. | Defer |
| Import known words FROM the existing Anki collection | ? | **expensive** | Needs a mapping from Anki notes to word identities, and a provenance marker distinguishing imported status from status earned in-app. Retrofitting provenance means backfilling every existing row. | Hedge schema |
| Non-Anki SRS target | ? | cheap | The export seam covers this. | Defer |
| Cloze / sentence cards rather than word cards | ? | cheap | Different payload construction at the export boundary. | Defer |

## Data Model

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| **Word identity: lemma-based rather than surface-based** | ? | **expensive** | The one-way door of this project. Chinese has no inflection so surface form works; Dutch does (`loopt` / `gelopen` / `liep` are one word). If status is keyed on surface form, adding lemma-based identity is a migration of the single most valuable table, with no reliable way to merge accumulated history. | **Decide before slice 1** |
| Word-status history / statistics over time | ? | **expensive** | Requires an event log. If only current status is stored, past transitions are unrecoverable — the data was never written. | Hedge schema |
| Multiple users / accounts | ? | **expensive** | Adding a tenant key to populated tables. Cheap to hedge now, painful later. | Hedge schema |
| Word-level notes or tags by the user | ? | cheap | Additive table. | Defer |

## Product Surface

| Change | Plausibility | Retrofit cost | Reasoning | Action |
|---|---|---|---|---|
| Frequency / HSK-level word ordering | ? | cheap | Additive reference data joined at read time. | Defer |
| Audio / TTS for words and sentences | ? | cheap | New field and a UI control. | Defer |
| Offline reading (PWA) | ? | medium | Constitution already requires it, so it is not deferred. Retrofitting offline onto an API-chatty client is a real rework — worth respecting from slice 1. | Required by Principle |
| Character stroke order / handwriting | ? | cheap | Isolated feature, additive reference data. | Defer |

---

## Open Question Blocking Slice 1

**What is the identity relation on words, and is it the same in Chinese and Dutch?**

It is not. Chinese words are uninflected, so the surface string is a serviceable key. Dutch is
inflected, so surface form over-counts: a learner who knows `lopen` does not encounter four
unknown words when they meet `loopt`, `liep`, `gelopen`.

This must be settled before any word-status row is written, because it is the one decision here
with no cheap retrofit. It is the first thing `/speckit-clarify` should resolve.
