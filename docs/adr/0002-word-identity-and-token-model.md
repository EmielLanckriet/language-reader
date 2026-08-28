# ADR-0002: Word Identity and Token Model

**Status**: Accepted
**Date**: 2026-08-28
**Relates to**: Constitution Principle V; [ADR-0001](0001-seam-placement-policy.md);
`docs/anticipated-changes.md` (entry "Word identity", rated high / expensive)

## Context

Word status is the only data this application produces that cannot be regenerated. It is earned
over months of reading. Every other artifact — segmentation, pronunciation, definitions — is
derived from source text and reference data and can be recomputed at will.

Word status must therefore attach to something stable. The question is what a "word" *is*, and
the initial assumption recorded in the anticipated-changes register — that Chinese lacks
inflection and so the surface string is a serviceable key — is wrong. Chinese word identity is
not simple:

- **Word-hood is undefined.** 中国人 segments as 中国 + 人 or as 中国人; 研究生命 as 研究生 + 命 or
  研究 + 生命. Analyzers disagree with each other and across their own versions. A token stream is
  a choice, not a fact, and re-segmentation is therefore inevitable.
- **Heteronyms.** 长 is cháng (long) and zhǎng (grow, senior); likewise 行, 好, 重, 乐, 数. One
  surface form, two lexemes. Keying on surface makes it impossible to know one and not the other.
- **Separable verbs (离合词).** 帮忙 appears as 帮了他一个忙 — one word occupying two
  non-adjacent ranges of text.
- **Abbreviation and reduplication.** 北京大学 → 北大; 看 → 看看.

Dutch, the second target language, presents the analogous problems through different mechanisms:
inflection (`loopt` / `liep` / `gelopen` as one lexeme), separable verbs (*Ik bel je morgen op*
for *opbellen*), and orthographic reform variants.

The requirement is to begin with Chinese, defer inflection handling entirely, and remain able to
add Dutch without migrating accumulated status.

## Decision

**1. Status attaches to a surrogate lexeme id, never to a string.**

```
lexeme(id, language, surface)
word_status(user_id, lexeme_id → lexeme.id, status, provenance, updated_at)
status_event(user_id, lexeme_id, from_status, to_status, source, at)
```

Refining identity later becomes a merge or split of lexemes — repoint rows, combine status —
rather than a rewrite of the status table. This converts word identity from a one-way door into
a reversible operation, at a cost of one integer column.

**2. The identity rule belongs to the language provider, not the schema.**

The schema states only that lexemes exist and have surfaces. What counts as the same word is a
function `(surface, context) → lexeme` owned by the language provider. Chinese v1 defines it as
the analyzer's surface form. Dutch will later define it as the lemma. Neither requires a schema
change, because the schema never encoded a rule.

**3. Chinese v1 identity policy: the analyzer's surface form, unnormalized.**

Reduplications are distinct words (看看 ≠ 看). Abbreviations are distinct words
(北大 ≠ 北京大学). Heteronyms are not split (长-cháng and 长-zhǎng share one lexeme in v1).
Splitting them later is a lexeme split driven by recorded token pronunciations, and requires
adding one nullable discriminator column to `lexeme` — cheap, because nothing references the
surface string.

**4. Language-specific annotation is expressed as a value paired with its scheme.**

```
token(document_id, lexeme_id, start, end,
      pronunciation, pronunciation_notation,
      pos, pos_tagset)
document(id, raw_text, analyzer, analyzer_version, ...)
```

`pronunciation_notation` is `pinyin` for Chinese and `ipa` for Dutch; `pos_tagset` names the
analyzer's tagset. The domain core reads values and schemes and never branches on language. Only
the language provider interprets a scheme.

This explicitly forbids Chinese-shaped columns. A `pinyin` column would not have been reusable
by Dutch. The same reasoning reclassifies Simplified/Traditional as orthographic variation — a
general phenomenon that Dutch (spelling reforms) and English (-ise/-ize) also exhibit — rather
than as a Chinese quirk.

**5. Pronunciation is recorded on occurrences, not on lexemes.**

Pronunciation is context-dependent and is an observation, not an identity. Recording it per
token preserves the evidence needed for a later heteronym split; recording it per lexeme would
presuppose the split.

**6. Tokens carry a single contiguous span in v1.**

Separable verbs will consequently be recorded as two unrelated words until this changes. See
Consequences.

**7. Reading position anchors on character offsets into the raw text, never on token indices.**

Re-segmentation is inevitable per Context; token indices are therefore unstable. This resolves
the "reading position" hedge in the anticipated-changes register.

**8. Ingest captures what cannot be recovered later**: context-resolved pronunciation per token,
POS tag per token, analyzer name and version per document, and the raw source text verbatim.

**9. Earned tables carry `user_id` from the first migration**, defaulted to a single local user.
This is a schema hedge against the "multiple users" register entry (medium / expensive), not a
commitment to build accounts.

## Alternatives Rejected

**Key word status on `(language, surface_form)` directly.** Rejected because it is a one-way
door: every later refinement of identity — heteronym splits, Dutch lemmas, abbreviation merging
— becomes a migration of the only irreplaceable table, with no reliable way to combine the
status of two rows that turn out to be one word.

**Encode the identity rule in the schema — for example a `lemma` column populated per
language.** Rejected because it presupposes that lemmatization is the correct identity relation
in every language. It is not the relation Chinese needs, and choosing it now would make Chinese
carry a column it cannot fill meaningfully.

**Store pronunciation on the lexeme as part of the identity key.** Rejected on the objection
that pronunciation is an occurrence-level observation. Making it part of identity would commit
v1 to splitting heteronyms — the opposite of the intended deferral — and NULLs in a uniqueness
constraint behave unhelpfully in SQLite.

**A generic `annotation(key, value)` table instead of named value/scheme column pairs.**
Rejected as the entity-attribute-value anti-pattern: it discards type checking, turns ordinary
queries into repeated self-joins, and makes constraints unexpressible. The goal is a
language-neutral *vocabulary*, not a schemaless table.

**Multi-span tokens in v1.** Rejected as deferrable because tokens are derived data. Raw text is
preserved verbatim, so a better token model is obtained by recomputation, not migration. The
cost of deferral is that separable verbs are mis-segmented in the interim, which degrades
Chinese slightly and Dutch more — acceptable while Chinese is the only supported language.

## Consequences

**Easier.** Identity can be refined incrementally as the corpus teaches what a word is, without
risking accumulated status. Dutch is addable without touching the schema. Heteronym splitting
remains available because the evidence is being recorded now.

**Harder.** Separable verbs are wrong until multi-span tokens exist — 帮忙 is recorded as 帮 and
忙, and *opbellen* as *bel* and *op*. Chinese v1 over-counts vocabulary, since 看看, 看, and
北大 are three entries where a learner might reasonably want fewer. Merge and split operations
on lexemes must eventually be built and tested; they are the mechanism the whole design depends
on, and they do not exist yet.

**Revisit if.** Over-counting proves annoying in real reading — the honest test is whether the
known-word count feels wrong after a few weeks. Or when Dutch is added, since separable verbs
are more central there than in Chinese and may force multi-span tokens at that point.

## Note

The general rule underlying decisions 1, 6 and 7 — that **earned data must be hedged and
derived data need not be, because it can be recomputed** — is a sharper criterion than the
expensive/cheap test in ADR-0001. It is promoted into Constitution Principle V by
[ADR-0003](0003-earned-versus-derived-data.md).
