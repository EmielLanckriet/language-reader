# Contract: changes to the two file formats

## anki-words.json, format 2 (was 1: specs/006-anki-baseline/contracts/anki-words.md)

Each word also has:

| Field | Type | From |
|---|---|---|
| `difficulty` | number \| null | card `data.d` (FSRS difficulty, 1–10); null without FSRS data |
| `lastReview` | ISO string \| null | newest `revlog.id` for the card (ms since epoch) |
| `decay` | number \| null | card `data.decay` (its preset's w20) |

And the file has `parameters`: `{ preset, weights: number[21], retention }` or null, the FSRS-6
weights (DeckConfig field 6) and desired retention (field 37) of the preset whose w20 most cards
carry as `decay`. An import records them as an `anki-parameters` encounter when they differ from the
last recorded.

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
