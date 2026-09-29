# SenseVoice-Small in the browser: measurements

The evidence behind the "Speech-to-text in Reader with SenseVoice" entry in `docs/backlog.md`.
Tooling only; nothing here ships. `sensevoice.mjs` is the verified starting point for Reader's own
version.

## Setup

- Model: `model.int8.onnx` and `tokens.txt` from
  [csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17](https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17),
  plus `silero_vad.onnx` from sherpa-onnx's `asr-models` release for `cuts.py`.
- Python (a venv): `pip install sherpa-onnx soundfile numpy onnx`, then
  `python export_meta.py model.int8.onnx > meta.json` into the model directory.
- Node: `npm install` here (onnxruntime-web 1.30.0, onnxruntime-node).
- Audio: 16 kHz mono 16-bit WAV (`ffmpeg -i media.mp4 -ac 1 -ar 16000 a.wav`).

## Laptop

- `sherpa_ref.py` — sherpa-onnx's transcript in fixed windows, the reference.
- `check.mjs` — the JS pipeline against that reference, window by window (`web` or `node`
  runtime). Expect identical text except at near-tied tokens.
- `cuts.py` — fixed 30 s, 30 s with 2 s overlap, and pause-based cutting at a given VAD threshold.
- `first-check.mjs` — a short first window (10 or 15 s) against 30 s throughout (spec 008 R3).
- `resample.mjs`, `resample-check.mjs` — the downmix-and-resample step against ffmpeg's 16 kHz
  (decoded audio as raw 44.1 kHz stereo float32 from `ffmpeg -f f32le -ac 2`), and
  `pair-check.mjs` for the control: two ffmpeg resamplers against each other (spec 008 R4).

## Phone (Chrome, over USB)

1. Cut the interview into 30 s chunks `s0.wav`… in an audio directory.
2. `python phone/serve.py <model dir> <audio dir> results.jsonl` and `adb reverse tcp:8799 tcp:8799`.
3. `phone/run.sh results.jsonl '{"threads":1}' '{"threads":2}' '{"threads":4}'` — one fresh page per
   setting, since onnxruntime-web fixes its thread count at startup. The phone must be unlocked.
4. `cores.html` shows whether several workers really run in parallel (the A71 has 2 fast cores).
5. `decode.html` decodes an ADTS AAC file (`ffmpeg -i media.mp4 -vn -c:a copy -f adts street.aac`)
   with WebCodecs in a worker, resamples it, and compares with the laptop's 16 kHz
   (`street-ref16.f32`, raw float32) served from the audio directory.

## Reproducing the resume audio comparison

From the repository root, with Node 24:

```sh
node scripts/measure/sensevoice/resume-audio.mjs /path/to/street-interview.mp4 /tmp/resume-results.json
adb -d reverse --no-rebind tcp:18799 tcp:18799
```

When the phone is free, open `http://127.0.0.1:18799/` in its Chrome. The worker compares the actual
app's decoded/resampled samples for uninterrupted playback, resume at window 5, and two controls
that decode from frame zero. Use an AAC-LC recording longer than 178 seconds. Results are posted
to the local server and saved at the supplied output path. No model download or Reader data is
used. Stop with Ctrl-C and remove only this mapping: `adb -d reverse --remove tcp:18799`.

The checked-in results and `docs/audio-resume-investigation.md` record the 2026-09-29 A71 run.
This measures audio equivalence, not ASR quality or long-video memory use.
