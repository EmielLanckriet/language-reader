# Contract: The Termux Reader Service

`scripts/termux/reader-service.py`, on `127.0.0.1:8765`. It is started at boot by Termux:Boot, and
by opening Termux if it is not already running. Every response carries
`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Private-Network: true` and
`Cache-Control: no-store`, and `OPTIONS` answers the preflight.

| Request | Response | Notes |
|---|---|---|
| `PUT /backup` with a copy | `204`, or `400` if not JSON with a matching `integrity` | Stored as `~/.reader/backups/<createdAt>.json`, written atomically. Keeps the newest 20, plus the newest of each of the last 30 days |
| `GET /backup/latest` | `200` with the newest copy, `404` if none | Used by restore |
| `GET /backup` | `200` with a list of `{createdAt, bytes, documents, words}` | Offers a choice of copy when more than one exists |
| `GET /downloads` | `200` with recent jobs, newest first: `{job, title, id, bytes, transcribing, ready}`, and `progress` (`{stage, title, part, percent}`) while one is still downloading | "New from Termux" in the library (ADR-0022), with a bar from the moment of the share |
| `GET /downloads/<job>/<file>` | The file | Live transcripts (ADR-0019) and bundles for restoring videos |
| `GET /media/<youtubeId>` | `200` with `{job}` of the newest bundle whose `meta.json` has that id, `404` if none | Finds a video after a restore (R8) |
| `GET /health` | `200 {"version": n}` | How the app tells "service down" from "no copy yet" |

The service verifies `integrity` before storing, so a truncated upload never becomes the latest
copy. It never deletes a copy younger than 30 days.
