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
| `boot` | Console output and uncaught exceptions during start-up. |
| `firstload` | A first visit does not reload itself. Exists because it did, for 614 ms, and the reload was silently failing three other scenarios (research.md R21). |
| `shell` | The service worker takes control and the manifest is real. |
| `words` | Real segmentation is visible in the reader and the words are words. |
| `offline` | Reading with the server stopped. Warms with `words`, then stops the server. |
| `readonly` | A second copy refuses a change it cannot keep (the storage lease). |
| `model` | Downloads the model (~110 MB over the network) and checks the analyzer switches. Slow. |
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
