# Data model: Find videos by due and new words

Nothing here is stored in the reader's database. Candidates live on the page only.

## Candidate (page state)

| field | meaning |
| --- | --- |
| `id` | YouTube id |
| `url` | the watch address handed to the download |
| `title`, `channel`, `duration` | from the search |
| `state` | `searching` → `fetching` → `scored` / `no-chinese` / `rate-limited` / `failed`; `rate-limited` and `failed` go back to `fetching` only when the reader retries |
| `automatic` | the chosen track is YouTube's automatic Chinese |
| `score` | when scored: `known` (share 0–1), `due` (words, by written form, most frequent first), `neverMet` (count), `understood` |
| `inLibrary` | a document already holds this video, or a job for it is downloading or ready |

## Score inputs (read-only, from the storage worker)

- `wordsByForm(language, forms)`: for each written form, its lexeme id if one exists and whether it
  was ever met (mark, memory, encounter range, review); never writes.
- `getStates`, `getMemory`: as the library's figures use them.

## Settings (localStorage)

- `reader.find.bar`: whole percent, 70–99, default 90.
- `reader.find.recent`: up to five distinct queries, newest first.
