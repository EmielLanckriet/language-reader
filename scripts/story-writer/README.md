# The laptop's story writer (spec 016)

Reader's stories (Texts → Write me a story) are written on the laptop whenever it answers, and by
the phone's own model otherwise. To make the laptop available:

```sh
~/Documents/SideProjects/Anki/.venv/bin/python scripts/story-writer/server.py \
  --model ~/Documents/SideProjects/Anki/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf
adb -d reverse tcp:8766 tcp:8766     # the phone over USB
```

On Wi-Fi instead: add `--host 0.0.0.0` and, once, in Termux:
`echo '{"url": "http://<laptop address>:8766"}' > ~/.reader/laptop.json`.

The phone's reader service checks `GET /health` (3 s) before each draft and falls back to the
phone when the laptop does not answer. One draft at a time; about 20–60 s each on this laptop.
