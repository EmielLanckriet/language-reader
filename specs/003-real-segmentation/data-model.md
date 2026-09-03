# Data Model: Real Segmentation, Measured (Slice 2)

**Branch**: `003-real-segmentation` | **Date**: 2026-09-02

## Summary Of Change

**No earned table changes shape.** This slice rewrites `token` rows and updates two columns on
`document`. Everything the reader cannot get back is untouched.

That is the whole claim slice 0 made and never tested, stated as a schema diff:

| Table | Classification | Change in this slice |
|---|---|---|
| `document` | `raw_content` **earned**; the rest derived | `analyzer`, `analyzer_version` updated in place |
| `token` | **derived** | rows deleted and rewritten per document |
| `lexeme` | identity, **earned by association** | rows added as new words appear; none deleted |
| `word_state` | **earned** | untouched |
| `status_event` | **earned** | untouched |
| `device`, `diagnostic`, `schema_migration` | infrastructure | untouched |

**There is no migration file in this slice.** A migration is for changing shape; nothing changes
shape. Token rewriting is a recompute performed by application code inside a transaction.

## Entities

### Document

Unchanged in shape. Two columns take new values.

| Column | Type | Notes |
|---|---|---|
| `raw_content` | TEXT NOT NULL | **Earned. Never written by this slice.** Every re-derivation reads it and no path writes it (`FR-014`). |
| `analyzer` | TEXT NOT NULL | `"intl-segmenter-zh"` after this slice; `"character-splitter"` before it |
| `analyzer_version` | TEXT NOT NULL | Now a **behaviour fingerprint** (ADR-0011), e.g. `29aef947ef0d39e0`, not a hand-written `"1"` |

A document is **stale** when `(analyzer, analyzer_version)` differs from the active analyzer's. That
comparison is the only state this slice needs: there is no `needs_rederivation` flag, no queue table,
and no progress row. Staleness is derived from data already present, which is why an interruption
cannot leave a lie behind (`FR-021`).

### Token

Derived, and fully rewritten. Shape unchanged from slice 0.

| Column | Type | Notes |
|---|---|---|
| `document_id` | INTEGER | |
| `lexeme_id` | INTEGER NULL | Present exactly when `is_word` |
| `start`, `end` | INTEGER | **Code-point offsets**, converted from `Intl.Segmenter`'s UTF-16 indices. See R2 — this is the slice's highest-risk conversion. |
| `is_word` | INTEGER | Markability, **not** `isWordLike`. Han script only. See R7. |

Token counts drop sharply: measured, 5,000 code points produced 3,084 tokens under `Intl.Segmenter`
against 5,000 under the character splitter.

### Lexeme

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | Surrogate (ADR-0002). The reason re-segmentation is a recompute and not a migration. |
| `surface` | TEXT | Now multi-character for most entries |
| `language` | TEXT | `zh` |

**Lexemes are added, never removed.** Re-derivation creates lexemes for words that did not previously
exist (中国 where there were only 中 and 国). Placeholder-era character lexemes remain, because marks
point at them and those marks are earned (`FR-025`).

The consequence, which the spec calls out: a reader who marked 中 known keeps that mark, and 中 may
no longer appear as a standalone word in any document. The mark stays **in storage**, retrievable
under the same lexeme id. It is not displayed anywhere, because no screen displays vocabulary yet.
FR-025 is scoped to storage for exactly that reason, and the missing screen is registered as an
anticipated change.

### Segmentation unit *(transient, not persisted)*

A span of a document bounded by a line break or sentence-final punctuation, produced by the language
provider's delimiter set (ADR-0013). Units exist only during analysis. They are never stored, because
they are recoverable from the source and the provider at any time.

Invariant: units concatenate to the source exactly, so whole-document tiling (`FR-006`) is what
detects a wrong delimiter set.

### Analyzer fingerprint *(transient, not persisted as an entity)*

Computed at startup by segmenting a committed probe string and hashing the `(offset, text)` sequence.
Persisted only as `document.analyzer_version` on the documents it stamps.

### Comparison sample *(not in the database at all)*

Lives in `scripts/compare-segmenters/` as files in the repository (ADR-0012). Passages of the
reader's material, each candidate's segmentation, and the report. Deliberately outside the
application: it is evidence, not reader data, and it never reaches the device.

## Validation Rules

Derived from the functional requirements, expressed as properties rather than examples per
Constitution Principle II.

1. **Tiling** (`FR-006`) — tokens ordered, non-overlapping, gapless, concatenating to `raw_content`
   exactly. Asserted **over the whole document**, never per unit, so a wrong delimiter set fails
   here.
2. **Offsets are code points** (analyzer contract obligation 2, R2) — every `start`/`end` is a valid code-point index into
   `raw_content`; verified with astral-plane input, where UTF-16 and code-point indices diverge.
3. **Determinism** (`FR-009`) — re-analysing unchanged text under an unchanged fingerprint produces
   identical tokens.
4. **Idempotence** — re-deriving an already-current document is a no-op producing identical rows.
5. **Coverage** (`FR-008`) — every code point belongs to exactly one token, including characters no
   dictionary knows.
6. **`is_word` honesty** (`FR-007`) — punctuation, whitespace, digits and Latin runs are tokens and
   are not markable.
7. **Stamp consistency** (`FR-020`) — no document is observable with tokens from one analyzer and a
   stamp from another. Enforced by writing both inside one transaction.
8. **Earned data untouched** (`FR-023`–`FR-025`) — the count and content of `status_event` and
   `word_state` rows are identical before and after re-derivation. Asserted exactly, not as a
   property: this is earned data (Principle II).

## State Transitions

The only transition this slice introduces, per document:

```
stale  ──(opened by reader, FR-015)──▶  current
  │                                        ▲
  └────(picked up by sweep, FR-016)────────┘
```

Both edges call **the same function** over one document in one transaction. That is how `FR-017`
("the two paths MUST agree") is satisfied by construction rather than by testing two implementations
against one another.

There is no intermediate persisted state. A document is stale or current; interruption leaves it
stale, and stale is a safe resting state that is retried on the next open or the next sweep.

## What Is Deliberately Absent

- **`reading_session`** — deferred on 2026-09-02 with the loss accepted. It is earned, it does not
  exist, and it stays out of this slice.
- **The `status_event` occurrence columns** (`document_id`, `from_offset`, `to_offset`,
  `observed_pronunciation`) — the hedge from slice 0 remains present and null. Filling them is a
  write, not a migration, so the register's own rule defers it.
- **A re-derivation queue or progress table** — staleness is derived from `(analyzer,
  analyzer_version)`; persisting it as well would create a second source of truth that can disagree.
