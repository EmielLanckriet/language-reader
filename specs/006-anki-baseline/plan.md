# Implementation Plan: My Anki Words As A Starting Point

**Branch**: `006-anki-baseline` (work on `main`) | **Date**: 2026-09-26 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/006-anki-baseline/spec.md`

## Summary

A laptop script reads a copy of the reader's Anki collection and writes `anki-words.json`: each
studied word with its Anki level, from FSRS stability. With `--push` it copies the file to the phone.
In Reader, Diagnostics takes the file, previews it, and imports it in one transaction as ordinary
events whose provenance names Anki, the import and the strength. Words the reader marked themselves
are never touched; re-importing writes only what changed; undo appends the earlier states, with a new
retraction event for words that had none. Four new state names with their own shades show the levels.
No migration and no copy-format change. Research in [research.md](research.md), the file in
[contracts/anki-words.md](contracts/anki-words.md), decision in
[ADR-0024](../../docs/adr/0024-anki-words-imported-as-events.md).

## Technical Context

**Language/Version**: TypeScript (SvelteKit app), Python 3 standard library (the laptop script)
**Primary Dependencies**: none new
**Storage**: SQLite in OPFS, unchanged schema. Imports are `status_event` rows; a retraction is an event
**Testing**: vitest + fast-check for import, re-import, undo and the retraction's replay; one Python
unittest for the level rules; one browser scenario (`anki`) for the picker and preview plumbing
**Target Platform**: Chrome on Android (installed); the script on the reader's Linux laptop
**Project Type**: offline-first web app plus a laptop script
**Performance Goals**: the 2,128-word import in one transaction, under a few seconds on the phone
**Constraints**: Anki's file never written or locked (Principle III); import all-or-nothing (FR-006)
**Scale/Scope**: ~2,100 words per import, a few imports a month

## Constitution Check

| Principle | Status |
|---|---|
| I. Ships to the phone | The import is done on the reader's phone with their real collection before this is done |
| II. Test-first on state transitions | **Applies in full.** The import writes earned data, and the retraction changes the projection, which is on the mandatory list. Import, re-import against the reader's own marks, undo, and replay of a retraction are tested first, each made to fail by mutation. The file picker and preview are glue: one browser scenario |
| III. Anki read-mostly | **Applies.** Read-only by construction: the script copies the file and opens the copy read-only; nothing in this slice can write to Anki. SC-005 checks the original's checksum |
| IV. Vertical slice | Script, import, display and undo ship together |
| V. Seams | The import takes a parsed word list, so another source (AnkiDroid, a word list) is a second reader of the same shape |
| VI. ADR during planning | [ADR-0024](../../docs/adr/0024-anki-words-imported-as-events.md), written with this plan |
| VII. Readable | Not touched beyond the usual |
| VIII. Fast first | Not a derived result; not applicable |

**Gate: passes.**

## Project Structure

### Documentation (this feature)

```text
specs/006-anki-baseline/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
└── contracts/anki-words.md
```

### Source Code (repository root)

```text
scripts/anki/
├── export-words.py        # copy, read-only read, levels, --push (the only code that sees Anki)
└── test_export_words.py   # the level rules
src/lib/domain/
├── state.ts               # + the four Anki levels, + RETRACTED; projectStates drops a retracted word
└── anki.ts                # parse anki-words.json; plan an import against current states (pure)
src/lib/storage/
├── repository.ts          # + importAnki(plan) and undoAnkiImport(id), one transaction each
└── worker.ts, protocol.ts, client.ts   # the two calls, as reader changes
src/routes/diagnostics/+page.svelte     # Anki words: pick, preview, import, undo
src/lib/ui/app.css                      # the four levels' shades
tests/anki/                             # import, re-import, undo, retraction
```

**Structure Decision**: the rules (what to write for each word) are a pure function in
`domain/anki.ts`, so they are tested without a database; the repository only applies a plan in a
transaction. The same split as `projectStates` and `assertState`.

## Complexity Tracking

None.
