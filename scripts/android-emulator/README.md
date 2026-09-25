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

`media` needs a real bundle at `build/test-bundle.tar` (run `scripts/termux/termux-url-opener` on
the laptop once to get one). Termux can fetch the scripts from the laptop too:
`SOURCE=http://localhost:4175/language-reader/termux` with `scripts/termux/*` copied into `build/termux/`.

## What bit

- **Chrome's DevTools socket** appeared only after `adb shell am force-stop com.android.chrome` and a
  fresh start.
- **Only the visible tab gets storage** (ADR-0010). A tab opened over DevTools while Termux is in
  front waits at "Opening your library…" indefinitely — correct behaviour, not a hang. Bring Chrome
  forward first. Scenarios run back to back can hit the same wait while the closed tab lets go;
  run them one at a time. (A suspicion about the hand-off time, not measured.)
- **Termux picks a random mirror**, and one in China made setup look stuck for minutes. Output
  piped through `curl -T -` is buffered, so a quiet log is not a stopped process.
- **Installing the app did not work** from `http://localhost`: "Install" produced nothing. Either
  WebAPK minting refuses localhost or it needs a Google account in the Play Store. Untested which.
