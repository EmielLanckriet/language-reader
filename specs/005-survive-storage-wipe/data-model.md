# Data Model: The Reader's Work Survives A Storage Wipe

**No migration.** Nothing new is stored in the app's database. The copy is a file held by Termux,
and the safeguard state is computed each time it is shown. Its one persisted part, when the last
copy went out, lives in `localStorage`. It is derived and harmless to lose: a lost value reads as
"stale", which errs toward warning.

## Copy (format 1)

The full contract is in [contracts/copy-format.md](contracts/copy-format.md).

| Field | Meaning | Rule |
|---|---|---|
| `format` | Copy format version | Integer. A restore accepts `1..current` |
| `app` | Build that wrote it | For diagnostics only |
| `createdAt` | When the snapshot was taken | ISO 8601 |
| `writer`, `devices[]` | the writing device; `{id, nextSeq}` | Every device that has events. Restoring these keeps `(device_id, device_seq)` unique |
| `documents[]` | `{id, title, language, contentType, rawContent, createdAt, media?}` | `id` is the copy's own; a restore renumbers and events follow. `media` is `{subtitles: {name, text}, meta}` for a media document |
| `events[]` | `{deviceId, deviceSeq, surface, language, asserted, assertedAt, documentId?, from?, to?, observedPronunciation?, provenance}` | In log order. `(surface, language)` identifies the lexeme. `documentId` must name a document in the copy |
| `states[]` | `{surface, language, state, provenance}` | Must equal replaying `events` (checked on write and on restore) |
| `corrections[]` | Empty until spec 004 | Reserved so that 004 adds data without a new format |
| `integrity` | SHA-256 of the canonical JSON of everything above | Checked before any write |

**Excluded on purpose**: tokens, analyzer stamps, upgrade progress, and diagnostics (all derived);
media files (R8).

## Safeguard state

| Safeguard | Source | Unprotected when |
|---|---|---|
| Installed | `display-mode: standalone` | Not standalone |
| Storage protection | `navigator.storage.persisted()` | `false` |
| Copy | The last successful send (`localStorage`), compared with the last earned write | Older than 5 minutes while there are changes, or never sent |

## State transitions of a copy

```
unsent changes ──(30 s quiet / background / 5 min)──▶ sending ──ok──▶ current
      ▲                                                  │
      └──────────────── error (service unreachable) ─────┘  (stale once past 5 min → warning)
```
