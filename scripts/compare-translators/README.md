# Offline translation measurement

See [findings](../../docs/offline-translation-comparison.md) and [all translations](results/comparison.html). This is a standalone research harness, not production integration. Run from the repository root. Models, Android builds and downloaded dependencies are not committed.

## Laptop engines

Use Node 24 and the project's installed dependencies. Install the Bergamot runtime in a disposable directory; the Mozilla script adds a Node compatibility shim to its worker in that directory because npm 0.4.9 mixes CommonJS worker code with an ES-module package.

```bash
npm install --prefix /tmp/reader-translation-bench @browsermt/bergamot-translator@0.4.9
node scripts/compare-translators/prepare-opus.mjs /tmp/reader-translation-bench
python3 scripts/compare-translators/download-mozilla.py /tmp/reader-translation-bench/mozilla-2.1
node scripts/compare-translators/run-opus.mjs /tmp/reader-translation-bench "$OPUS_MODEL_DIR" /tmp/opus-results.json
node scripts/compare-translators/run-mozilla.mjs /tmp/reader-translation-bench /tmp/reader-translation-bench/mozilla-2.1 /tmp/mozilla-results.json
```

`OPUS_MODEL_DIR` must contain `tokenizer.json`, `onnx/encoder_model_quantized.onnx`, and `onnx/decoder_model_merged_quantized.onnx` from Xenova/opus-mt-zh-en. Match the hashes in `results/manifest.json` for the measured weights. Preparation builds the current Reader source, so later source changes can change results. The recorded run used the implementation present at commit fd3a9b4. Run engines sequentially; avoid builds during measurement.

Optional quality control: install Transformers.js 4.3.0 separately, predownload its q8 OPUS model into that package's `.cache`, then run `run-opus-beam.mjs <transformers-package-root> <output-json>`. This script forbids remote model access during execution. It uses native CPU, so do not compare its times directly to WASM.

## Android emulator only

Build with JDK 17, Android SDK 35, Gradle 8.10.2 and the included AGP 8.7.3 configuration. Copy `corpus.json` into `android/app/src/main/assets/` first. Run `gradle -p scripts/compare-translators/android --no-daemon --max-workers=2 assembleDebug` with the appropriate JAVA_HOME and ANDROID_HOME. Install the debug APK using **adb -e**, never an untargeted adb command.

The standalone package is `io.reader.translationbench`. Start `.MainActivity` with `--ez download true` to download models. Poll `run-as io.reader.translationbench cat files/download.json` for readiness or `files/error.txt` for errors. Stop the app before the translation run. Record network settings, disable emulator Wi-Fi and data, and verify `dumpsys connectivity` reports no active default network. Launch with `--ez download false`. Poll `files/results.json` until it contains 112 rows (deadline two minutes), or stop on `files/error.txt`. Remove stale result/error files between runs. Copy the JSON out with `adb -e exec-out run-as io.reader.translationbench cat files/results.json`.

Always stop the owned benchmark app and restore the emulator's previous network settings, including after a failure. The recorded run restored Wi-Fi and mobile data to enabled. Do not run this benchmark on the physical phone while thermal validation remains open.

## Data and interpretation

`corpus.json` is frozen and self-contained. `make-corpus.py <tariff-vtt> <cooking-vtt>` reconstructs it from retained source subtitles, but reruns do not require those original temporary paths. The first 20 cues from each source are reused in the joined groups, with no spelling correction. There are only two topics, some ASR errors, and one incomplete joined group.

Raw JSON retains both timing rounds; the HTML displays first-round text (identical across rounds). Manifest summaries use second-round median, nearest-rank p95, and summed call durations. Process RSS and sampled Android PSS have different definitions. File writes and PSS collection occur outside each timed translation call. No battery, temperature, phone latency, or end-to-end browser measurement is claimed.
