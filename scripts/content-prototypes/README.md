# Content prototypes (issues #10 and #11)

Laptop-only experiments: nothing here is imported by the app, and nothing is written to Reader.
Keep the reader's backup, exports and every output derived from them outside the repository.

All scoring uses the app's own code from `src/lib`, loaded through Vite as `scripts/fsrs` does
(`lib/app.mjs`):

- **Library**: a Reader backup restored into an in-memory database (`Repository.restoreCopy`),
  every document re-segmented with the shipped segmenter (`bert-ws-zh`: `analyzer/tagger.ts` and
  `bert-tokenizer.ts` with onnxruntime-node and the model file cached by
  `scripts/compare-segmenters`), corrections applied by `replaceTokens`, then `rebuildMemory`.
- **Due**: an active card (`queue.ts` `isActive`) whose reading memory is due now, as Cards and the
  library's word counts count it (`shares.ts` `wordCounts`).
- **Known**: `shares.ts` `kindOf` — reading recall of 85 % or more now (`colourBand` ≤ 2), else a
  known or Anki mature/long-term mark. "Known running words" is `textShares(...).known`, ignored
  words left out. `understood` (#13) is reported beside it.
- **Never met**: not inside any read/played/lookup/check encounter, no Anki example, no mark, no
  encounter naming it (a review) and no memory row
  (`ENCOUNTERED_WORDS` plus those); set-aside words are counted apart.
- A candidate text is saved as an ordinary document (no history) and measured like a library
  entry.

Scripts (Node 24, this checkout's dependencies; onnxruntime-node from
`scripts/measure/sensevoice/node_modules`):

```sh
# Restore once (about 3 min) and check: fully watched library videos must show 0 never-met words.
node scripts/content-prototypes/check-library.mjs BACKUP.json /tmp/x/library-bert.sqlite
# #11: rank subtitles fetched with yt-dlp (see below).
node scripts/content-prototypes/score-subtitles.mjs BACKUP.json /tmp/x/library-bert.sqlite SUBS_DIR INFO.jsonl
# Score texts given as JSON lines on stdin ({"text": ...}); {"words": true} lists due/known words.
node scripts/content-prototypes/score-server.mjs BACKUP.json /tmp/x/library-bert.sqlite bert|dictionary
# #10: stories from Qwen3-4B (llama_cpp; sentencegen's venv), checked in the loop with the
# dictionary analyzer (no second model resident); measure the results with score-server … bert.
python scripts/content-prototypes/generate-story.py --backup BACKUP.json --cache /tmp/x/library-bert.sqlite --out /tmp/x/stories
```

Fetching subtitles only (on this laptop yt-dlp needs `--js-runtimes node`):

```sh
yt-dlp --js-runtimes node --flat-playlist -j "ytsearch15:QUERY"            # candidates
yt-dlp --js-runtimes node --skip-download --sleep-requests 1 -j URL…       # which tracks exist
yt-dlp --js-runtimes node --skip-download --write-subs --sub-langs 'zh…' --sub-format vtt \
  --sleep-requests 1 --sleep-subtitles 1 -o 'SUBS/%(id)s/%(id)s.%(ext)s' URL
```

Wrap anything that loads a model (the segmenter, Qwen) in a shared `flock` when other jobs run
models on the same machine.
