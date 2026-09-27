# Contract: changes to the two file formats

## anki-words.json, format 2 (was 1: specs/006-anki-baseline/contracts/anki-words.md)

Each word also has:

| Field | Type | From |
|---|---|---|
| `difficulty` | number \| null | card `data.d` (FSRS difficulty, 1–10); null without FSRS data |
| `lastReview` | ISO string \| null | newest `revlog.id` for the card (ms since epoch) |

Still produced from a **copy** of the collection opened read-only (Principle III). The Reader reads
formats 1 and 2. Format 1 words get difficulty 5 and the import's date, and the seed records that
the date was not known.

## Copy format 2 (was 1: specs/005-survive-storage-wipe/contracts/copy-format.md)

```ts
interface CopySession   { deviceId; deviceSeq; documentId; modality; startedAt; userId }
interface CopyEncounter { deviceId; deviceSeq; session?: { deviceId; deviceSeq }; kind;
                          language?; surface?;              // the lexeme, as events carry it
                          documentId?; from?; to?; mediaMs?; speed?; textVisible?;
                          detail: Record<string, unknown>; at; userId }
CopyBody += { sessions: CopySession[]; encounters: CopyEncounter[] }
CopyDocument += { removedAt?: string }
```

`upgrade()` maps format 1 to 2 by adding empty `sessions` and `encounters`. Restoring re-creates both
by `(deviceId, deviceSeq)`, so restoring twice duplicates nothing. `memory` is derived and never
copied: it is rebuilt after a restore.
