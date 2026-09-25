# Testing on an Android emulator

For when the phone is not at hand. The emulator runs Chrome and Termux; the laptop serves the build
to it as `localhost`, which Chrome treats as secure, so the service worker and OPFS behave as on
the phone.

## Once

```sh
# Android SDK command-line tools, emulator and a Play image (Play services: needed to install the app)
mkdir -p ~/Android/Sdk/cmdline-tools && cd ~/Android/Sdk/cmdline-tools
curl -fsSLO https://dl.google.com/android/repository/commandlinetools-linux-13114758_latest.zip
unzip -q commandlinetools-linux-*.zip && mv cmdline-tools latest
yes | latest/bin/sdkmanager --licenses
latest/bin/sdkmanager platform-tools emulator "system-images;android-35;google_apis_playstore;x86_64"
echo no | latest/bin/avdmanager create avd -n reader -k "system-images;android-35;google_apis_playstore;x86_64" -d pixel_6
# Termux from F-Droid
curl -fsSLO https://f-droid.org/repo/com.termux_1002.apk && ~/Android/Sdk/platform-tools/adb install com.termux_1002.apk
```

## Each session

```sh
~/Android/Sdk/emulator/emulator -avd reader -no-window -no-audio -gpu swiftshader_indirect &
BASE_PATH=/language-reader npm run build
node scripts/verify-in-browser/serve.mjs build /language-reader 4175 &
adb reverse tcp:4175 tcp:4175                              # the emulator's localhost:4175 is the laptop
adb forward tcp:9333 localabstract:chrome_devtools_remote  # Chrome's DevTools on the laptop
node scripts/verify-in-browser/harness.mjs lookup --cdp 9333 --app http://localhost:4175
```

`media`, `live` and `translate` import through "New from Termux", as the reader does:
`scripts/verify-in-browser/make-fixtures.sh <video> <vtt> <root>` lays out two jobs, and
`python3 scripts/termux/reader-service.py --root <root>` serves them. Forward its port with
`adb reverse tcp:8765 tcp:8765`, after stopping the emulator's own service
(`pkill -f reader-service.py` in its Termux) if setup has started one. Then run the transcriber or
translator the script prints (`WHISPER_FIRST_MODEL=tiny WHISPER_MODEL=tiny`, `TRANSLATE_STUB=1`).
Each check takes seconds. Keep checks short: full-length videos are for measuring speed or
accuracy, once, not for testing.

`wipe` (spec 005) needs the reader service instead of a transcriber:
`python3 scripts/termux/reader-service.py --root <fresh dir>` and `adb reverse tcp:8765 tcp:8765`.
It marks two words, waits for the copy, clears the origin's storage, restores, and takes about 10 s.

## What bit

- **Chrome for Android 154 refuses `/json/new`** ("Could not create new page"); the harness falls
  back to `Target.createTarget` on the browser connection.
- **Sharing a file from Termux into Reader fails** (ADR-0022), which is why nothing is shared any more.

- **Typing into Termux with `adb shell input text`** cannot type Chinese, and text typed while a
  script runs goes to that script's stdin. Fetch a script from the laptop and pipe it to `bash`.
- **A home-screen shortcut looks installed**: it reports `display-mode: standalone`, but storage
  protection is refused. Only `persisted()` tells them apart.
- **A plain `-DGGML_NATIVE=OFF` build is slow**: 4.4× slower without AVX2 (x86) or dotprod (ARM).

- **Chrome's DevTools socket** appeared only after `adb shell am force-stop com.android.chrome` and a
  fresh start.
- **Only the visible tab gets storage** (ADR-0010). A tab opened over DevTools while Termux is in
  front waits at "Opening your library…" indefinitely — correct behaviour, not a hang. Bring Chrome
  forward first. Scenarios run back to back can hit the same wait while the closed tab lets go;
  run them one at a time. A 3 s pause between runs failed and 20 s worked; why is not yet known.
- **Termux picks a random mirror**, and one in China made setup look stuck for minutes. Output
  piped through `curl -T -` is buffered, so a quiet log is not a stopped process.
- **Installing the app needs a Google account in the Play Store.** Chrome builds the WebAPK, then
  Play refuses it: `WebAPK service unknown_account` in logcat. Without one, Chrome falls back to a
  shortcut, which is not a share target. Note too the second "Install" in a confirmation dialog.
- **The deployed app can be tested here**: `--app https://emiellanckriet.github.io`, with
  `--bundle http://127.0.0.1:8765/test-live.tar` for `live` (the transcriber serves it with CORS).
