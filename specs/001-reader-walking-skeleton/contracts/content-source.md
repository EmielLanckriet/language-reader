# Contract: Content Source Seam

The second of Principle V's named seams. Slice 0 supplies **one** implementation, so this boundary
is asserted rather than demonstrated — recorded honestly rather than glossed. It is justified by
the register, where subtitles and YouTube transcripts both rate `high`, not by the single instance
present here.

## Interface

```ts
export interface ContentSource {
  readonly kind: string;         // 'paste' | 'epub' | 'subtitle' | ...

  ingest(input: unknown): Promise<IngestedDocument>;
}

export interface IngestedDocument {
  rawContent: string;    // verbatim; the retained input everything else derives from
  contentType: string;   // 'text/plain', later 'text/html', 'application/x-subrip'
  language: string;
  title: string;
}
```

## Obligations

1. **`rawContent` is verbatim.** No trimming, normalising, collapsing of whitespace, or newline
   rewriting. This is the retained input of ADR-0003's preserve-the-inputs corollary: everything
   derived is rebuilt from it, and a source that quietly edits it converts derived data into earned
   data without saying so.
2. **`contentType` is declared, not inferred later.** `text/plain` here. HTML must be storable
   without touching existing rows, which is the whole reason the column exists.
3. **Validation before construction.** Empty or whitespace-only input, and input over the size
   limit, are rejected with a message naming the problem (FR-018, FR-020) — before any document
   exists, so a rejected import leaves nothing behind.
4. **No storage.** Sources produce documents; the repository stores them.

## Slice 0's implementation

`paste.ts` — `kind: 'paste'`. Takes a string, validates it is non-empty and within roughly 5,000
code points, emits `text/plain` with `language: 'zh'` and a title from the opening characters.

`title` is derived and may be recomputed freely; it is not earned.
