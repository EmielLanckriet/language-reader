# Contract: story generation

## Reader → Termux service

`POST /generate` with `{"messages": [{"role": "system"|"user"|"assistant", "content": "…"}],
"max_tokens": 700, "temperature": 0.7}` → `202 {"job": "<id>"}`.

`GET /generate/<id>` → `200 {"state": "writing", "where": "laptop"|"phone"}`,
`{"state": "waiting", "where": "phone"}` (the model is busy translating),
`{"state": "done", "where": …, "text": "…", "seconds": n}` or `{"state": "failed", "error": "…"}`;
`404` for an unknown job. Jobs live in memory and are forgotten after an hour.

## Termux service → laptop writer

Tried in order: `http://127.0.0.1:8766` (the laptop over USB: `adb reverse tcp:8766 tcp:8766`), then
the `url` in `~/.reader/laptop.json` (the laptop on Wi-Fi). `GET /health` must answer within 3 s.
Then `POST /generate` with the same body, answered synchronously: `200 {"text": "…"}`.

## Termux service → story.py

`python3 ~/bin/story.py` with the request on stdin; prints `waiting` on stderr while translate.py's
model budget is held elsewhere, then the text on stdout. `STORY_STUB=1` answers a fixed story.
