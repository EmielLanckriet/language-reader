# Contract: Re-Derivation

What it means for a document's tokens to be brought up to date with the active analyzer, and what
each of the two paths promises.

This contract exists because slice 0 made a claim — "swapping the analyzer is a recompute against
retained source, not a migration" — that has never been executed. This is that claim, written as
obligations.

## The single operation

```ts
/** Bring one document up to date with the active analyzer. Idempotent. */
rederiveDocument(documentId: number, analyzer: Analyzer): Promise<void>
```

**There is exactly one implementation.** Both paths call it. `FR-017` requires that opening a
document and sweeping it produce identical tokens; that is satisfied by construction, not by testing
two implementations against each other.

## Obligations

1. **Reads earned data, writes derived data.** Reads `document.raw_content`; writes `token` rows,
   new `lexeme` rows, and the document's `analyzer` / `analyzer_version`. MUST NOT write
   `raw_content`, `status_event`, or `word_state`.
2. **Atomic per document.** Token deletion, token insertion and the stamp update happen in one
   transaction. A document is never observable with one analyzer's tokens under another's stamp
   (`FR-020`).
3. **Idempotent.** Called on a current document, it is a no-op producing identical rows.
4. **No intermediate persisted state.** Staleness is derived by comparing the document's stamp to the
   active analyzer's. There is no flag, queue, or progress row that could disagree with reality.
5. **Interruption leaves the document stale, never partial.** Stale is a safe resting state, retried
   on next open or next sweep (`FR-021`).
6. **Lexemes are added, never deleted** (`FR-025`). A placeholder-era character lexeme carrying a
   mark survives even when no document contains it as a standalone word, and stays retrievable by
   the same id. Retained is not the same as visible: nothing displays vocabulary yet, so such a mark
   is safe and unreachable until a screen for it exists.

## Path A — on open (`FR-015`)

**Trigger**: the reader opens a document whose stamp differs from the active analyzer's.

**Promise**: the reader never sees placeholder tokens in a document they have opened. Re-derivation
completes before the document renders.

**Latency**: segmentation is measured at 3.8 ms per 5,000 code points, so the cost is dominated by
storage. If it is nonetheless slow enough to notice, the reader is told what is happening
(`FR-022`).

## Path B — the catch-up sweep (`FR-016`)

**Trigger**: the application is idle and stale documents exist.

**Promise**: the library becomes uniform without the reader waiting for it.

**Obligations specific to this path**:

- **Yields to the reader** (`FR-018`). MUST NOT delay opening a document, marking a word, or
  importing text. The document on screen takes priority. One document at a time, released between
  documents.
- **Requires the storage lease** (`FR-019`). A copy that does not hold storage MUST NOT sweep. Slice
  1 established that a read-only copy accepts nothing it cannot keep; the sweep is bound by the same
  rule, and must not itself become a source of lease contention.
- **Stops rather than retries hard.** A document that fails to re-derive is left stale and the sweep
  moves on. It will be retried; it must not spin.
- **Discoverable, not loud** (`FR-022`). Progress and failures are visible where slice 1 put
  invisible work: the diagnostics page. The reader is not notified.

## Triggering condition

A document is stale when `(document.analyzer, document.analyzer_version)` differs from the active
analyzer's `(name, version)`.

Because the Chinese analyzer's version is a **behaviour fingerprint** (ADR-0011), this condition also
fires when the browser's ICU changes underneath the application. That is deliberate: ICU drift
becomes ordinary re-derivation rather than an undetected inconsistency, and it needs no separate
detection mechanism.

## What is explicitly not promised

- **No ordering guarantee** on which stale documents the sweep takes first.
- **No completion guarantee** within any particular session. The sweep is best-effort; correctness
  rests on Path A, which is not.
- **No reinterpretation of past marks.** A character marked known under the placeholder stays a
  marked character. Turning it into a word would be inventing earned data.
