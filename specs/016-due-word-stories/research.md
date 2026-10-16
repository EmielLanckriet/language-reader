# Research: Stories with your due words

## R1. Which model writes, and how well (laptop, 2026-10-16)

| | known | due words used | never met | time per story |
| --- | --- | --- | --- | --- |
| Qwen3-4B-Instruct (laptop) | 86–94 % | 5–10 of 10 | 0–6 | 53–66 s (quiet laptop) |
| Qwen3-1.7B, thinking off (the phone's) | 82–92 % | 0–7 of 10 | 1–13 | 32–71 s (laptop, 4 threads) |

The 1.7B must be told `/no_think`: otherwise it spends its answer thinking in English and the
stories come out cut off (16–76 % known in that run). Read as a Chinese reader: free to drop words,
its everyday stories are simple and fairly natural but use few due words; pushed to use them, it
forces wrong collocations (建设了一个游戏, 取新功能, 让知识更份). Hence the reader's choice: the laptop
when it is online, the phone otherwise.

## R2. Loop in Reader, not in Termux

The draft check needs the library's words and analyzer, which live in Reader; Termux only writes.
So the service exposes one generic generation job and Reader runs the loop (prompt, score, rewrite).

## R3. Reaching the laptop

Over USB the laptop is `127.0.0.1:8766` on the phone after `adb reverse`; on Wi-Fi, an address the
reader saves once in `~/.reader/laptop.json`. A 3 s health check decides; nothing is discovered on
the network.
