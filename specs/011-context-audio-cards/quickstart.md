# Verification
Run focused context/queue/import/backup/audio lifecycle tests before browser checks. Mutation-check
encounter exclusion, target alignment, import idempotence and clip-end cancellation. Export synthetic
Anki SQLite fixture and import its archive in an isolated browser. Confirm source text, example and
word playback, review source identity, no history change from replay, hidden-page stop and reload.
Use 60-second synthetic media, no model downloads. Then export the actual collection read-only,
transfer the local bundle to phone, deploy, and import it only with the user's existing authorization.
Never restore personal data into test origin. Check installed build and preserve original phone settings.


## Recorded 2026-10-03

- 447 unit tests passed; focused context/import/audio tests passed after the final playback changes.
- The Python exporter fixture passed; four deliberate mutations (cue mismatch, clip end, missing
  archive file, duplicate import) were detected. Hash-corrupt audio is rejected before metadata save.
- Type checking and the verification build passed. The new `cardaudio` disposable-browser scenario
  passed at 390px: original Anki text/English, sentence playback, word playback, and grade cancellation.
- The browser test caught an initialization issue: this project's build resolves Svelte's imported
  `onMount` to a no-op. Audio now uses the project's existing `$effect` lifecycle pattern.
- Actual read-only export: 2,126 matching examples, 4,032 non-empty recordings, 175,452,160-byte
  archive. Two sentences omitting their headwords were skipped and one empty recording was omitted.
  The bundle was copied to phone Downloads.
- The first installed-app validation found the empty clip and a slow 512-byte header scan, before
  any metadata was saved. `995ad68` scanned headers in 1 MiB blocks and the phone validated it.
  A first one-file-per-clip write was intentionally stopped at 21/4,032 clips because it was too
  slow for the phone; it committed no metadata.
- `fa2cda6` stores one indexed archive rather than eagerly copying each clip. The updated
  implementation passed its focused tests, full test suite, type checks and `cardaudio` browser
  scenario. The browser check confirmed imported playback and grade cancellation.
- Run [37107896213](https://github.com/EmielLanckriet/language-reader/actions/runs/37107896213)
  deployed it. The Samsung A71 installed build `1791014104698`, validated the 167 MiB bundle, and
  imported all 2,126 examples/4,032 audio clips. A real Anki-sourced card showed the retained
  example and its sentence control was invoked without grading. Phone temperature was 32.5–32.6°C.
  No synthetic reviews were added to daily Reader.

Temporary debugger mappings were removed; the pre-existing phone screen-awake setting was left at `2`.
