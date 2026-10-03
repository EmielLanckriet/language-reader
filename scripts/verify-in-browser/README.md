# Verifying in a browser

```sh
BASE_PATH=/language-reader npm run build
npm run verify:browser -- probe
```

Some of what this application promises cannot be checked by a unit test, because the promise is
about a browser: a service worker taking control, reading with the network gone, a second tab
refusing a change it cannot keep, a 98 MB model downloading and switching the analyzer. Those are
what lives here.

It is in the repository rather than a scratch directory because **arranging** a browser check has
repeatedly cost more than writing one, and three separate times the arrangement produced a failure
that read exactly like an application bug. Every guard in `run.mjs` is one of those. Left outside
the repository, the setup drifted from how the real host behaves and a broken download shipped.

## Running

`npm run verify:browser -- <scenario>` does the whole thing: checks the build, picks free ports,
serves the output, starts one throwaway Chrome, runs the scenario, and cleans up. Exit status is
the scenario's. Add `--keep` to leave the browser profile behind for inspection.

| scenario | what it establishes |
| --- | --- |
| `probe` | What is actually on the page — buttons, links, text. Run this first when a selector fails, instead of guessing. |
| `tuning` | Cards → Learning data, empty report and JSON export through the storage worker in a disposable profile. Use a verification-mode build. |
| `study` | One minute of synthetic reading → Finish → weekly credit → feedback → reload → correction; 390px light/dark screenshots in `/tmp/reader-progress-{light,dark}.png` and `/tmp/reader-library-light.png`. Use a verification-mode build. |
| `listened` | ◀ goes to the line before even 1.7 s into a line, ↻ replays the same line on a quick second press, and a video session's "Only listened" + "Partly" answers survive a reload; at about 2 AM (time zone emulated), "A day ends at" moves today back a day at 4 AM but not at midnight, and the choice survives a reload; Diagnostics shows the session opening with its stage/blur settings and a translation reveal; 390px screenshot in `/tmp/reader-listened.png`. Needs the fixture service on port 18765 (make-fixtures.sh) and a verification-mode build. |
| `cardaudio` | Imports a synthetic Anki seed and example/audio archive, checks source and English, plays both recordings and confirms grading stops playback. Uses a disposable profile/service; blocks model downloads. |
| `cardlayout` | Synthetic text lookup → flashcard front → answer → grade; checks hidden answers, pronunciation, meanings and mobile width. Front/light/dark screenshots in `/tmp/reader-card-*.png`. Use a verification-mode build. |
| `boot` | Console output and uncaught exceptions during start-up. |
| `firstload` | A first visit does not reload itself. Exists because it did, for 614 ms, and the reload was silently failing three other scenarios (research.md R21). |
| `shell` | The service worker takes control and the manifest is real. |
| `words` | Real segmentation is visible in the reader and the words are words. |
| `offline` | Reading with the server stopped. Warms with `words`, then stops the server. |
| `readonly` | A second copy refuses a change it cannot keep (the storage lease). |
| `model` | Downloads the model (~110 MB over the network) and checks the analyzer switches. Slow. |
| `sheet` | The word sheet fits a phone in full screen (landscape, ~384 px tall) and in portrait; screenshots to `sheet-*.png`. |
| `corrections` | Spec 004: join from the word sheet within a second, split back, refused across 。, undone from More back to the analyzer's cut. |
| `live` | Spec 008: a video without subtitles (make-fixtures.sh's `fixture-live`, served by `reader-service.py --root <dir>`) gets the speech-model offer, downloads it (239 MB, slow), shows its first lines within 20 s, and becomes a document with `media.zh.method.json`. Run the service with `READER_TRANSLATE=scripts/termux/translate.py TRANSLATE_STUB=1` to see the transcript handed back and translated. |
| `bigimport` | SC-004: a 4,999-character document imports and opens within 3 seconds **with the model on the device**. Warms with `model`, so it is slow. |

`model` really does fetch the weights from HuggingFace, so it takes minutes and needs a network.
It logs progress to `model-progress.log` in the working directory, because a check that looks
identical whether it is working or wedged is worth nothing.

## The guards, and why each exists

`run.mjs` refuses to run rather than produce a misleading result:

1. **The build must carry `BASE_PATH`.** GitHub Pages serves this application from a sub-path. A
   build made without it 404s every asset, and the resulting page looks like a broken application.
2. **The debug port must belong to the browser we started.** A leftover Chrome holding
   `127.0.0.1:<port>` makes the new one lose the bind and fall back to `[::1]`; `localhost` then
   resolves to the *old* browser with its old profile. This happened with a 21-hour-old Chrome and
   a scenario spent five minutes examining the wrong page. So the port is taken from the OS only
   after confirming it is free, `bind() failed` in Chrome's own log is treated as fatal, and a
   fresh profile is expected to contain exactly one blank tab.
3. **The server must compress what the host compresses.** `serve.mjs` gzips the extensions Pages
   gzips, and `run.mjs` asserts it. Without this, a `Content-Length`-versus-body check passed here
   and failed on every real attempt — the bug in research.md R14. A verification server kinder than
   production is not verification.

Guards 1 and 3 have been exercised by deliberately breaking each. Guard 2 has not: `run.mjs` picks
a free port, so the collision cannot be provoked from inside.

## Adding a scenario

Add a method to `scenarios` in `harness.mjs`, returning an object with `pass` and whatever evidence
made you believe it. Two rules, both bought with time:

- **Never sleep.** Poll a condition with `until(...)` and a deadline. Fixed waits produced two
  *false* failures in slice 1 and cost a whole debug cycle chasing a bug that did not exist.
- **Open a target, not a browser.** `openTab` / `close` reuse the one Chrome. Slice 1 launched
  thirty.

If a scenario needs something to have happened first, add it to `WARM_UP` in `run.mjs` rather than
assuming a warm profile — `offline` and `bigimport` are the worked examples. `bigimport` is also the
example of a check that is *worthless without its warm-up*: without the model downloaded, the
application uses the fast dictionary anyway and the timing would pass while proving nothing. It
therefore asserts the model is in use before it measures anything, rather than trusting the warm-up
to have worked.

Ad-hoc poking at a live page is fine and does not belong here; write it in a scratch directory and
throw it away. What belongs here is a check worth running again.

## Isolated phone and browser interaction

For synthetic lookups, reviews, corrections, imports, and recovery tests:

```sh
npm run verify:isolated             # laptop
npm run verify:isolated -- --phone  # USB phone, using adb -d reverse
```

This builds in `verification` mode, serves the test reader at
`http://127.0.0.1:4176/language-reader/`, and starts a disposable reader service at port 18765.
All app service callers use that port in this build; the daily reader continues to use 8765.
The test reader displays a banner and cannot launch the real Termux helper. The script prints its
service data directory, creates an empty downloads directory (no link to personal downloads), and
stubs translation. Put small fixture bundles under that directory's `downloads/` to test import.
The script refuses occupied ports or existing adb mappings and removes only mappings it creates.
Ctrl-C stops its servers; the temporary data directory is retained for inspection.

The script does not open or interact with the phone. Before driving it, check the foreground app
immediately before each input; pause if the user is using another app. Open the test address in
Chrome once it is appropriate. The test origin's browser data persists across runs, independently
of the fresh service root. For a clean run, clear only this test origin or use a fresh laptop
profile. Never restore personal learning backups into the test reader.

Separate URL paths, documents, or sessions are **not** storage isolation. Do not automate learning
interactions in the installed daily reader. Its installation/update behavior still needs a narrow
production-origin check, reported separately; localhost verification does not establish that.

The test build shares `build/` with normal local builds. Before production-like browser checks,
rebuild with `BASE_PATH=/language-reader npm run build`. CI always makes its own production build.
A speech checkpoint-write failure now retries from the saved window once, then reports failure;
the focused regression is `tests/speech/transcriber.test.ts`. This does not resolve the recorded
real-audio resume discrepancy in the backlog.
