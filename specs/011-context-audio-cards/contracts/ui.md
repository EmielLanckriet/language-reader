# UI and import contract
Cards name their source. Source link is offered only for an available Reader document. After Show
answer: Word pronunciation, Play example and Stop controls. No automatic audio or new passive events.
More accepts `anki-examples.tar`, reports counts/progress and errors. No scheduling imports are
implicitly applied with this supplementary bundle. Retain the bundle for restoring audio.
Bundle: USTAR regular files only, first `examples.json` with format `reader-anki-examples`, version 1,
profile, examples array and audio array {id, name, size, mime}. Audio names are `<sha256>.<extension>`
under `audio/`. Hashes and sizes match file bytes. Reject invalid offsets, missing targets, duplicate
names/keys, unknown assets, unsupported media types, unsafe paths and malformed/truncated archives.
