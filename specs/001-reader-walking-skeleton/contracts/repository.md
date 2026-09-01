# Contract: Repository (Storage Adapter)

Not one of Principle V's named seams — it is the adapter that keeps the fourth one honest. The
domain core must not import storage (Principle V.4), so the repository is where domain types meet
SQLite, and the **only** module permitted to know SQLite exists.

Enforced by `tests/architecture/domain-purity.test.ts`, not by intention.

## Interface

```ts
export interface Repository {
  // Documents
  saveDocument(doc: IngestedDocument, tokens: AnalyzedToken[],
               analyzer: { name: string; version: string }): Promise<DocumentId>;
  listDocuments(): Promise<DocumentSummary[]>;
  getDocument(id: DocumentId): Promise<StoredDocument>;   // raw content AND tokens

  // Judgments
  assertState(lexemeId: LexemeId, asserted: string,
              occurrence?: Occurrence): Promise<void>;
  getStates(lexemeIds: LexemeId[]): Promise<Map<LexemeId, WordState>>;

  // History
  readHistory(): AsyncIterable<HistoryEntry>;   // ordered by (device_id, device_seq)
  rebuildProjection(): Promise<void>;           // fold history → word_state
}
```

## Obligations

1. **`getDocument` returns retained raw content *and* tokens.** Not tokens alone. Pagination,
   re-segmentation and any future analyzer all need the text, and a shape that returns only tokens
   would have to be widened later — cheap in effort, but it is the kind of constraint that quietly
   decides slice 1's caching design.
2. **`assertState` appends before it projects.** It writes a `status_event` first, allocating
   `device_seq` from the device row, then updates `word_state`. Never the reverse: the history is
   the source of truth and the projection is a cache (FR-010a).
3. **`rebuildProjection` is exercised in tests, not only written.** It is the executable proof that
   `word_state` is derived. A projection nobody rebuilds is a claim, not a property.
4. **No update or delete of `status_event`**, ever. There is no interface method for it.
5. **Lexemes are found or created by the language provider's rule**, not by the repository's
   opinion. In slice 0 the rule is `(language, surface)`; the repository applies whatever the
   provider says (FR-009).
6. **Failures are recorded** to `diagnostic` and surfaced to the caller with enough detail to
   distinguish a refused input from a storage failure (FR-021, FR-022).

## Not in this contract

Deletion of documents or states, search, and export. Export is the near-certain next addition — it
is the only backup with no server — but it belongs to whichever slice builds it, and its format is
a decision with consequences of its own.
