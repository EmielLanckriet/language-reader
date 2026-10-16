# Contract: speaking a story

`POST /speak` with `{"title": "Story · 16/10/2026", "lines": ["我昨天去超市。", "…"]}` → `202
{"job": "<YYYYmmdd-HHMMSS>-story"}`; `400` without a title or a non-empty line.

The job is a folder in `downloads/`, listed by `GET /downloads` like a download: while it is made,
`progress` is `{"stage": "waiting"}` (the model is in use), `{"stage": "speaking", "percent": n}`,
`{"stage": "packing"}` or `{"stage": "failed", "reason": "…"}`; then `ready: true` with
`bundle.tar` holding `media.m4a` (AAC, mono, 24 kHz), `media.zh.vtt` (one cue per line, in order,
timed by the speaker) and `meta.json` (`{"title", "job", "kind": "story"}`). Reader imports it as
any bundle. speak.py then starts translate.py on the folder for English.
