# ADR-0047: A native wrapper, the database in a file of its own

Status: Accepted. Date: 2026-11-04. Takes ADR-0007's preserved option 2.

On 2026-11-04 Chrome erased Reader's origin storage in the middle of a video (the second wipe;
the phone 95% full, persistent storage granted). The library came back from Termux's copy, but the
condition the constitution names for option 2 — "if browser storage proves unreliable in
practice" — is met. Issue #54.

Decided:

- **The same app, bundled into a Tauri Android shell** (`src-tauri/`, built by `npm run android`).
  The APK carries the build; there is no service worker and no update prompt. Updates install
  over the old APK, signed by one key kept in `~/.config/reader/android-signing/` (losing it
  means one uninstall, and with it the app's data).
- **The database lives in `reader.db` in the app's private folder.** sqlite-wasm and
  `repository.ts` stay as they are, in the worker. A small VFS (`storage/native-file.ts`) keeps
  the file in memory and, when a transaction releases its write lock, sends the chunks it
  changed as one batch through the page to Rust (`src-tauri/src/store.rs`), which appends it to
  a checksummed log, fsyncs, and folds the log into the file on open. The file on disk is always
  a finished transaction; a crash loses at most the batches still in flight. On Android every
  `invoke` is JSON (bytes become arrays of numbers), so the page loads the file through the
  shell's `readerdb` URL scheme and sends batches as base64 parts of at most 1 MB.
- **Not Sapling's storage core.** Sapling's Rust core is Sapling's own domain; ours is 3,000
  lines of TypeScript. Native SQL behind it would cost an IPC round trip per query, and the
  repository makes hundreds per action. One batch per commit crosses instead.
- The PWA build is unchanged and keeps deploying, for reading on other devices; on the phone
  the native app replaces it.

Next, separately: videos read from where Termux keeps them instead of a second copy in app
storage, and native SenseVoice (#53).

Alternatives: the WebView's own OPFS unchanged (still browser storage, eviction behaviour
unknown); loading the GitHub Pages site in the shell (keeps push-to-deploy, but offline depends on
a service worker again and native file access would be granted to a remote origin); Termux as the
store (every view would depend on Termux running).
