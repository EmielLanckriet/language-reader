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

## Phone (Chrome, over USB)

1. Cut the interview into 30 s chunks `s0.wav`… in an audio directory.
2. `python phone/serve.py <model dir> <audio dir> results.jsonl` and `adb reverse tcp:8799 tcp:8799`.
3. `phone/run.sh results.jsonl '{"threads":1}' '{"threads":2}' '{"threads":4}'` — one fresh page per
   setting, since onnxruntime-web fixes its thread count at startup. The phone must be unlocked.
4. `cores.html` shows whether several workers really run in parallel (the A71 has 2 fast cores).
