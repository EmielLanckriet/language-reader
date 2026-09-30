# Verification
Run focused context/queue/import/backup/audio lifecycle tests before browser checks. Mutation-check
encounter exclusion, target alignment, import idempotence and clip-end cancellation. Export synthetic
Anki SQLite fixture and import its archive in an isolated browser. Confirm source text, example and
word playback, review source identity, no history change from replay, hidden-page stop and reload.
Use 60-second synthetic media, no model downloads. Then export the actual collection read-only,
transfer the local bundle to phone, deploy, and import it only with the user's existing authorization.
Never restore personal data into test origin. Check installed build and preserve original phone settings.


## Recorded 2026-09-30

- 445 unit tests passed; 10 focused context/import/audio tests passed after the final playback changes.
- The Python exporter fixture passed; four deliberate mutations (cue mismatch, clip end, missing
  archive file, duplicate import) were detected. Hash-corrupt audio is rejected before metadata save.
- Type checking and the verification build passed. The new `cardaudio` disposable-browser scenario
  passed at 390px: original Anki text/English, sentence playback, word playback, and grade cancellation.
- The browser test caught an initialization issue: this project's build resolves Svelte's imported
  `onMount` to a no-op. Audio now uses the project's existing `$effect` lifecycle pattern.
- Actual read-only export: 2,126 matching examples, 4,033 recordings, 175,452,160-byte archive,
  zero missing audio, two sentences omitting their headwords skipped. Copied to phone Downloads.
- Physical-phone verification and daily Reader import are pending: the connected phone is locked.
  No synthetic reviews or examples were added to daily Reader.

Deployment: commit `6958c4a`, successful [run 36725940137](https://github.com/EmielLanckriet/language-reader/actions/runs/36725940137). CI gates passed. Temporary servers/USB mappings were removed; phone screen-awake setting restored to `0`. Installed-phone acceptance is still pending unlock.
