# Phase 1 Data Model: Reader Walking Skeleton (Slice 0)

Every table below is created by `001-initial.sql`. Columns marked **hedge** support no slice-0
capability; they exist because they hold earned data or are one-way doors (Constitution
Principle V, ADR-0003), and the spec justifies each under *Requirements Deliberately Included
Before They Are Used*.

All data lives on the device. Nothing is stored remotely.

---

## Entities

### `lexeme` — the thing a state attaches to

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | **Surrogate.** Never a string key (FR-008, ADR-0002). |
| `language` | TEXT | `zh` in this slice. |
| `surface` | TEXT | The written form. An *attribute*, never the identity. |

Unique on `(language, surface)` **for slice 0 only** — that uniqueness is the Chinese provider's
current identity rule, not a property of the schema. When Dutch arrives with lemma-based identity,
or heteronyms are split, the rule changes and this constraint goes with it. FR-009 puts the rule in
the language provider; the constraint here is a convenience the provider currently justifies.

### `document` — something saved and read

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `raw_content` | TEXT | **Verbatim, unmodified** (FR-002). Everything derived is rebuilt from this. |
| `content_type` | TEXT | **Hedge.** `text/plain` here; HTML and subtitles later without touching stored rows. |
| `language` | TEXT | |
| `analyzer` | TEXT | **Hedge.** `character-splitter` in this slice. |
| `analyzer_version` | TEXT | **Hedge.** With `analyzer`, identifies what produced the tokens and makes re-derivation deliberate. |
| `title` | TEXT | Derived from the opening characters; not earned. |
| `created_at` | TEXT | Device time, ISO-8601. |
| `user_id` | INTEGER NOT NULL DEFAULT 1 | **Hedge.** Defaults to the single local reader (FR-013). |

### `token` — one occurrence, derived

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `document_id` | INTEGER FK | |
| `lexeme_id` | INTEGER FK NULL | Null for non-word tokens: punctuation, whitespace, Latin text. |
| `start` | INTEGER | **Code-point offset** into `raw_content`, inclusive (FR-014). |
| `end` | INTEGER | Code-point offset, exclusive. |
| `is_word` | INTEGER | Whether it is markable. Non-words are tiled but not tappable. |

**Derived data** (ADR-0003): discardable and rebuildable from `raw_content`. Nothing irreplaceable
lives here, which is what permits single contiguous spans in this slice — discontiguous words
(帮忙, *opbellen*) are a recompute later, not a migration.

### `word_state` — current judgment, a projection

| Column | Type | Notes |
|---|---|---|
| `lexeme_id` | INTEGER PK FK | One row per judged lexeme. |
| `state` | TEXT | Free text, not an enum (FR-006a). Nothing depends on there being four. |
| `provenance` | TEXT NOT NULL | **Hedge.** `manual` here; distinguishes marks earned in-app from imports (FR-012). Written explicitly on every insert — `NOT NULL` without a default, so omitting it fails loudly rather than storing a lie. |
| `user_id` | INTEGER NOT NULL DEFAULT 1 | **Hedge.** |

**A row exists only where a judgment was made** (FR-006b). Absence means never judged, which is
distinct from any state the reader can choose. Words merely displayed cost nothing.

This table is a **cache of a fold over `status_event`**, not an independent source of truth
(FR-010a, FR-011). It may be rebuilt from the history at any time, and a test asserts that doing so
changes nothing.

### `status_event` — the history, append-only

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `lexeme_id` | INTEGER FK | |
| `asserted` | TEXT | **What the reader asserted**, not what the state became (FR-010a). |
| `asserted_at` | TEXT | Device wall-clock, ISO-8601. For display and later cross-device ordering. |
| `device_id` | TEXT | **Hedge.** Which device recorded this (FR-010c). |
| `device_seq` | INTEGER | **Hedge.** Per-device counter, strictly increasing. **This is what orders the log** — exact, and immune to clock drift, adjustment and time zones. |
| `document_id` | INTEGER FK NULL | **Hedge.** The occurrence being judged. |
| `from_offset` | INTEGER NULL | **Hedge.** |
| `to_offset` | INTEGER NULL | **Hedge.** |
| `observed_pronunciation` | TEXT NULL | **Hedge.** Null in this slice; no pronunciation exists yet. |
| `provenance` | TEXT NOT NULL | **Hedge.** How this judgment was acquired (FR-012). Recorded per entry, not only on the projection, so the history stays self-contained. |
| `user_id` | INTEGER NOT NULL DEFAULT 1 | **Hedge.** |

Never updated, never deleted. The last four hedges retain *what the reader was looking at* — the
evidence any future sense discriminator would need, since same-reading homographs are told apart by
context and nothing else.

Unique on `(device_id, device_seq)`.

### `device` — this installation

| Column | Type | Notes |
|---|---|---|
| `id` | TEXT PK | Generated once, on first run. |
| `next_seq` | INTEGER | The counter's source. |

### `diagnostic` — on-device failure record

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `at` | TEXT | |
| `kind` | TEXT | |
| `detail` | TEXT | |

Serves FR-021: with no server there are no server logs, and Android offers no convenient console.

---

## Invariants

Each is a test obligation, and the first three are test-first under Principle II.

1. **Tiling** (FR-005). For every document, its tokens are ordered, non-overlapping, gapless, and
   concatenating their slices of `raw_content` reproduces it exactly. Asserted as a property over
   generated inputs — including punctuation, Latin text, newlines and astral-plane characters —
   **never against expected segmentations**, which encode one analyzer's opinion about undefined
   word-hood and break on every upgrade.
2. **Replay** (FR-011). Folding `status_event` in `(device_id, device_seq)` order through the
   current projection reproduces `word_state` exactly, for every lexeme.
3. **Offsets** (FR-014). Every `start`/`end` is a valid code-point offset into `raw_content`, and
   `start < end`. Round-tripping through the offset module reproduces the input.
4. **Append-only.** No code path updates or deletes a `status_event` row.
5. **Hedges present *and populated*.** A migration test asserts that `provenance`, `user_id`,
   `device_id`, `device_seq` and the occurrence columns exist and are `NOT NULL` or defaulted; a
   second test asserts that a row written through `assertState` carries a non-null `provenance` and
   `user_id` on both `word_state` and `status_event`. Presence alone is not the invariant — a
   column that exists and is never written is a hedge in name only, and slice 1 would inherit a
   write path that silently skips it. They are invisible in this slice, which makes them exactly
   what a later refactor would remove as dead weight.

## The projection

Slice 0's rule is the trivial one (FR-010b): a lexeme's current state is the `asserted` value of
its highest `device_seq` event. Nothing may depend on this remaining the rule — encounter counts
and lookups become inputs in later slices, at which point the fold changes and the history does
not.

## State set

`unknown`, `learning`, `known`, `ignored` — a **placeholder**, like the analyzer. Stored as text,
not an enumeration or a check constraint, so adding a state is data rather than a migration.
Redefining what an existing state *means* remains expensive, because it reinterprets marks already
made; that is the one part of the state model that is a one-way door.
