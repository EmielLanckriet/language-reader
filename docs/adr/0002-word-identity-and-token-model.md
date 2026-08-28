# ADR-0002: Word Identity and Token Model

**Status**: Accepted
**Date**: 2026-08-28
**Relates to**: Constitution Principle V; ADR-0001; the "word identity" entry in
`docs/anticipated-changes.md`

## Context

Word status is the only data this system accumulates that exists nowhere else. It cannot be
regenerated. Whatever key it is stored against is therefore the most expensive thing in the
project to change, and ADR-0001 requires such decisions to be made up front rather than deferred.

The initial framing assumed the hard case was Dutch inflection (`loopt` / `liep` / `gelopen` are
one word) and that Chinese, lacking inflectional morphology, could safely key status on the
surface string. That assumption was wrong. Chinese word identity is non-trivial for reasons
unrelated to inflection:

- **Word-hood is undefined.** 中国人 segments as 中国 + 人 or as 中国人; 研究生命 as 研究生 + 命
  or 研究 + 生命. Segmenters disagree with one another and across their own versions.
  Re-segmentation of an existing corpus is therefore inevitable, not hypothetical.
- **Heteronyms.** 长 is cháng (long) and zhǎng (grow, senior); likewise 行, 好, 重, 乐, 数. These
  are distinct words sharing a surface form. A surface key cannot represent knowing one and not
  the other.
- **Separable words.** 帮忙 appears as 帮了他一个忙 — one word occupying two discontiguous spans.
- **Abbreviation and reduplication.** 北京大学 → 北大; 看 → 看看.

A further constraint emerged during design review: solutions must not be Chinese-shaped.
Chinese-specific fields would fail to serve Dutch and would have to be generalized later, at
which point they are populated and expensive to change. Several phenomena first identified as
Chinese quirks are in fact general — separable words occur in Dutch (`opbellen` → "Ik bel je
morgen op"), and orthographic variation occurs in Dutch (the 1996 and 2006 spelling reforms)
just as Simplified/Traditional does in Chinese.

## Decision

**1. Status attaches to a surrogate lexeme identifier, never to a string.**

```
lexeme(id, language, surface)
word_status(lexeme_id → lexeme.id, status, provenance, ...)
token(document_id, lexeme_id, start, end, pronunciation,
      pronunciation_notation, pos, pos_tagset, ...)
```

Refining identity later is then a merge or split of lexemes — repointing rows and combining
status — rather than a rewrite of the status table. This converts word identity from a one-way
door into a two-way door at the cost of one integer column.

**2. The identity rule is owned by the language provider, not the schema.**

The schema states only that words have identity. What determines identity is a per-language
function. Chinese v1: identity is the surface form. Dutch, when added: identity is the lemma. No
schema change is required to move between these, because the schema never encoded either.

**3. Chinese identity policy for v1: surface form, with no normalization.**

看看 is a distinct lexeme from 看. 北大 is distinct from 北京大学. Heteronyms are not
distinguished in v1 — 长 is one lexeme — and may be split later using recorded token
pronunciations. This is provider policy and is revisable without migration.

**4. Language-specific annotation is recorded as a value paired with the scheme that interprets
it.** `pronunciation` + `pronunciation_notation` (pinyin, IPA, kana); `pos` + `pos_tagset`
(jieba, UD); `analyzer` + `analyzer_version`; `level` + `level_scheme` (HSK, CEFR). The domain
core reads values and schemes and never branches on language.

These MUST be named, typed columns paired with scheme columns. A generic `annotation(key,
value)` table is PROHIBITED — it is the entity-attribute-value anti-pattern, and it discards type
safety and queryability in exchange for a generality that named columns already provide.

**5. Pronunciation is a property of an occurrence, not of a lexeme.** It is observed in context
and recorded on the token. Lexeme-level pronunciation, if ever needed, is derived. This keeps the
raw observation authoritative and is what makes the later heteronym split possible.

**6. Tokens carry a single contiguous span in v1.** Discontiguous words (帮忙, `opbellen`) will be
segmented as separate tokens until this changes. Justified in Consequences.

**7. Ingest MUST capture, per token:** context-resolved pronunciation with its notation, the
analyzer's POS tag with its tagset, and per document the analyzer name and version plus the raw
source text verbatim. These are unrecoverable if not captured at ingest.

**8. Positions into documents anchor on character offsets into the preserved raw text, never on
token indices.** Re-segmentation changes token indices; it does not change the raw text.

## Alternatives Rejected

**Key word status on `(language, surface_form)` directly.** Rejected. It is the cheapest thing to
build and the only decision in the project with no viable retrofit: there is no identifier to
repoint, so any later merge silently destroys accumulated history.

**Include a reading or sense discriminator on `lexeme` from the start, as a hedge against
heteronyms.** Rejected as unnecessary. Because identity is a surrogate id and no table references
the surface string, adding a discriminator column later is cheap. Adding it now would encode a
distinction the v1 provider does not make, and it interacts badly with SQLite's treatment of
NULLs in unique constraints.

**Store pronunciation on the lexeme.** Rejected. It presumes identity has already been resolved
at the level pronunciation distinguishes, which is the question at issue. Recording the
observation per occurrence and deriving identity from it later is strictly more informative.

**A generic annotation key-value table, for maximum language neutrality.** Rejected as EAV; see
Decision 4.

**A list of spans per token, to handle separable words correctly from the start.** Rejected for
v1; see Consequences.

**Normalize reduplication and abbreviation onto their base forms in Chinese** (看看 → 看,
北大 → 北京大学). Rejected as provider policy: these are learned separately and are wanted as
distinct study items. Revisable without migration.

## Consequences

**Easier.** Word identity is now revisable, which was the point. Heteronym splitting, lemma-based
Dutch identity, Traditional/Simplified variants, and re-segmentation after a segmenter upgrade
are all merge/split or recompute operations rather than migrations. Dutch becomes addable without
tackling inflection now, which was the stated goal.

**Harder.** Every read of word status goes through a lexeme lookup rather than a string
comparison. Merge and split operations must be written and tested before they are first needed
under pressure. The value+scheme pairing means two columns where one would have done.

**On single-span tokens.** Tokens are *derived* data: the raw text is preserved verbatim, so
tokens can be discarded and recomputed by a better analyzer at any time. Changing the span model
is therefore a recompute, not a migration, and nothing irreplaceable is at risk. This is the one
place in this design where deferral is genuinely safe rather than merely hopeful, and the reason
is the earned/derived distinction recorded in ADR-0003.

**Revisit if.** Merge/split operations turn out to be materially harder to implement correctly
than assumed — that would mean identity is less revisable in practice than this ADR claims, and
the up-front cost of a discriminator column would have been worth paying.
