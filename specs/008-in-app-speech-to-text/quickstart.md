# Quickstart: validating spec 008

In the order that finds problems cheapest. The heavy measurements are already done
(`scripts/measure/sensevoice/`); these checks confirm that the app does what was measured.

## 1. Laptop, no browser (seconds)

```sh
npm test -- tests/speech
```

- **Window plan and join**: the keep ranges tile `[0, duration)` with no gap or overlap, and every
  token lands in exactly one window (fast-check).
- **Lines**: every token is in exactly one line, in order, at most 24 characters, times
  non-decreasing.
- **Resume**: a transcript stopped after window k and resumed equals the uninterrupted one. This is
  the one plumbing test, with a fake worker.

Before keeping each test, mutate the code it covers and see it fail (CLAUDE.md).

## 2. Laptop, the ported pipeline (a minute)

```sh
cd scripts/measure/sensevoice
node check.mjs <model> <tokens> <meta> chef.wav ref-chef.json   # expect 5/6 identical, as before
```

Plus a Node run of `src/lib/speech/` on both clips: its text must equal `transcribeLong` from the
measured module with the same windows. The port must change nothing.

## 3. Browser checks (`npm run verify:browser`), only those this can reach

- `firstload`, `shell`: the service worker controls the page, and there is still no self-reload.
  After a second load, `crossOriginIsolated` is true.
- `offline`, `readonly`: storage still works under isolation (R6's sqlite risk).
- A new `transcribe` scenario: open a pending 90 s clip with the model present, see the first lines
  appear, and see it become a document. Uses the short fixture, not the full videos (memory "short
  test fixtures").

## 4. The phone (one deploy, all checks batched)

With stay-awake on and over USB:

1. **Update, isolation, download**: accept the update and check `crossOriginIsolated` over CDP.
   Download the model; cut Wi-Fi halfway, restore it, and see it resume. Then the calibration runs
   in about a minute and picks 2 threads.
2. **SC-001, SC-002, SC-007**: download the street interview in Termux (it no longer transcribes)
   and open it.
   - First lines within 20 s of playable.
   - Played at once: lines trail by at most about 20 s early on, and none is late after about two
     minutes.
   - The whole transcript done before playback ends.
   - A lookup is as quick as with no transcript running.
   - Record the time per window (R13: does quick English slow it?).
3. **SC-004, FR-019**: close Termux after the video is in Reader; the transcript completes.
   Reopen Termux; the transcript is sent and the LLM translation arrives on the read page.
4. **SC-005**: start Chef Wang, swipe Reader away halfway, and reopen. It resumes with no duplicated
   or missing line. There are no lines over the music outro (SC-003).
5. **SC-006**: Wi-Fi off, download a video earlier and open it offline. It transcribes.
6. **Termux**: `setup.sh` removed the whisper binaries and models (about 720 MB freed).

Record the numbers in the spec's phone-check notes and the backlog, as earlier slices did.
