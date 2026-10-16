# Contract: reader service endpoints for Find videos

All on the reader service's port (8765; 18765 in verification builds), with the same CORS as
`/downloads`. yt-dlp runs one at a time; a request arriving while one runs waits for it.

## `GET /search?q=<query>&n=<count, default 15, at most 20>`

`200` with a JSON array, in YouTube's order:

```json
[{ "id": "RjacHpjQ8nQ", "url": "https://www.youtube.com/watch?v=RjacHpjQ8nQ",
   "title": "…", "channel": "…", "duration": 742 }]
```

`429` `{"state": "rate-limited"}` when YouTube refused; `502` `{"error": "…"}` for other yt-dlp
failures (no network included).

## `GET /subtitles?id=<youtube id>`

`200` `{"state": "ok", "tracks": [{"lang": "zh-CN", "name": "Chinese (China)", "kind": "human",
"text": "WEBVTT…"}]}` with only Chinese tracks (`zh`, `zh-*`), human ones from the first pass,
automatic ones only when the first pass brought no Chinese; the same rule and fields as the
opener's `tracks.json`. `200` `{"state": "no-chinese"}` when there is none. `429`
`{"state": "rate-limited"}`. `502` `{"error": "…"}` otherwise. Nothing is kept: the temporary
directory is removed.

## `POST /download` with body `{"url": "https://www.youtube.com/watch?v=…"}`

Starts `termux-url-opener <url>` detached, exactly as a share to Termux does; `202` `{}`. Only
`https://www.youtube.com/watch?v=` and `https://youtu.be/` addresses are accepted, otherwise
`400`. The job then appears in `GET /downloads` like any other.
