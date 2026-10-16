# Issue #14 measurements: bit-exact resume, a second pass, kernels

Laptop-only tooling, run 2026-10-16; nothing here ships. Run from the repository root with Node 24.
The scripts import `src/lib/speech/` through Vite, so they measure the app's own code. Model files
are the same as in `../README.md` (SenseVoice `model.int8.onnx` and `tokens.txt` in one directory).

## 1. Resume: are the samples at a resume point the same as an uninterrupted decode's?

- `resume-preroll.mjs <audio.m4a> <out.json> [targets s]` bundles `SpeechAudio` and runs it in
  headless Chrome's WebCodecs. It times and compares four things against the app's uninterrupted
  run: a pre-roll of N AAC frames (2…2048), a bounded replay from frame 0 (steps of 10 or 60 s), a
  fresh decoder for every window, and a second uninterrupted run. The M4A needs its `moov` box at
  the front (`ffmpeg -i in.m4a -c copy -movflags +faststart out.m4a`), or `SpeechAudio.open` reports
  "no audio track". Set `TMPDIR` to a short path: Chrome's profile socket fails under a long one.
- `fdk/fdkrange.c` decodes ADTS frames [from, to) with Fraunhofer FDK-AAC, Android's platform AAC
  decoder. `fdk/preroll.py <fdkrange> <file.adts> [limiter]` compares pre-rolls against a
  from-zero decode. To build it: clone `mstorsjo/fdk-aac`, run
  `cmake -S src -B build -DBUILD_SHARED_LIBS=OFF && cmake --build build`, then
  `gcc -O2 -Isrc/cpp/libAACdec/include -Isrc/cpp/libSYS/include fdkrange.c build/libfdk-aac.a -lm -lstdc++`.
  Make the ADTS file with `ffmpeg -i in.m4a -vn -c:a copy -f adts out.adts`.
- `fresh-asr.mjs <model dir> <film.adts> <fdkrange> <excerpt list> <out dir> [preroll]` runs the
  SenseVoice transcript twice, once from one FDK decoder started at frame 0 and once from a fresh
  decoder per window, and writes the result for `score.py`.

## 2. A second pass, and Qwen3-ASR, against human subtitles

- `excerpts.py <ref.vtt> [n] [seconds]` picks excerpts where the subtitles are dense, cut in gaps
  of at least 1 s between subtitle cues.
- `passes.mjs <model dir> <f32 44.1 kHz stereo> <shift s>` makes two passes over an excerpt: the
  app's windows, and windows shifted by `shift` seconds. Every token keeps its CTC posterior. The
  tokens are checked against the app's `transcribeWindow`.
- `qwen.py <model dir> <16 kHz wav> <out.json> [chunk s] [threads]` runs Qwen3-ASR-0.6B int8 through
  sherpa-onnx 1.13.8 (`sherpa-onnx-qwen3-asr-0.6B-int8-2026-03-25` from sherpa-onnx's
  `asr-models` release). Use `flock` around it, since the model is about 1 GB.
- `score.py <ref.vtt> <list> <dir>` scores character error rate (Han characters only) for each
  pass, for the two passes combined (by posterior, by window position, and the oracle bound), and
  for Qwen. With `FILLERS=1`, interjections are dropped from both sides.

## 3. Kernels

- `kernels.mjs <model dir> <16 kHz wav> <dir with node_modules/sherpa-onnx> [seconds...]` times one
  window at one thread through onnxruntime-web, sherpa-onnx's WebAssembly build (npm `sherpa-onnx`
  1.13.8), and onnxruntime-node.
