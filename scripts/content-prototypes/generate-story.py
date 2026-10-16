"""Issue #10 prototype: a short story with the reader's due words, from a local Qwen3-4B.

    flock LOCK python generate-story.py --backup BACKUP --cache CACHE.sqlite --out DIR \
        [--model GGUF] [--variants plain,pool,revise] [--n 10] [--stories 3]

Runs with the Python that has llama_cpp (sentencegen's venv). Due and known words come from
score-server.mjs (the app's memory over the restored library); each draft is checked there with
the app's dictionary analyzer, which loads no model, so only one model is ever resident. The final
measurement with the shipped segmenter is a separate step (score-server.mjs ... bert), run after
this process has exited.

Variants:
  plain   due words only, "use simple everyday words"
  pool    due words plus the most frequent words the reader knows, as the vocabulary to use
  revise  pool, then up to two rewrites naming the words outside what the reader has met
  choose  every due word offered, the model picks 6-8 that fit an everyday story; then as revise
Every story, prompt, timing and in-loop measurement is written to DIR/stories.jsonl.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL = os.path.expanduser(
    "~/Documents/SideProjects/Anki/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf")

SYSTEM = ("You write short graded readers in simplified Chinese for one adult learner. "
          "Write natural, idiomatic Mandarin as a native speaker would tell a simple story.")

PLAIN = """Write a short story in simplified Chinese, about {length} Chinese characters long.

It must use these words (each at least once, in its ordinary everyday meaning):
{due}

Rules:
- Apart from those words, use only very common everyday words (HSK 1-3 level). No idioms, no
  literary or formal words.
- One simple, coherent story with a beginning and an end; plain spoken style; short sentences.
- Output only the story: no title, no pinyin, no English, no notes."""

POOL = """Write a short story in simplified Chinese, about {length} Chinese characters long.

It must use these words (each at least once, in its ordinary everyday meaning):
{due}

The reader knows the words below. Build every other part of the story from them (and from
particles and numbers). Avoid any word that is neither in this list nor in the list above.
{known}

Rules:
- One simple, coherent story with a beginning and an end; plain spoken style; short sentences.
- Natural Mandarin: do not force a word in where a native speaker would not use it; if one of the
  required words really does not fit, leave it out rather than write an odd sentence.
- Output only the story: no title, no pinyin, no English, no notes."""

CHOOSE = """Write a short story in simplified Chinese, about {length} Chinese characters long, about
ordinary daily life (family, friends, food, shopping, school, travel, a small problem solved).

The reader is reviewing these words:
{due}
Choose the 6 to 8 of them that fit together naturally in one such story, and use each chosen word
at least once, in its ordinary everyday meaning. Leave out any word that would sound forced.

The reader knows the words below. Build every other part of the story from them (and from
particles, numbers and names). Avoid any word that is neither in this list nor in the list above.
{known}

Rules:
- Concrete events and people, told in order, with a little dialogue; plain spoken Mandarin as a
  native speaker would tell it; no slogans, no news or business-report language.
- Output only the story: no title, no pinyin, no English, no notes."""

REVISE = """Here is your story:

{story}

The reader has never met these words in it: {unknown}
Rewrite the story so that it no longer needs them: replace each with a word from the known list
or rephrase, keeping the story natural and keeping the words from this list that it already
uses: {due}.
Output only the rewritten story."""


class Scorer:
    """score-server.mjs with the dictionary analyzer, held open for the whole run."""

    def __init__(self, backup: str, cache: str, analyzer: str = "dictionary"):
        self.proc = subprocess.Popen(
            ["node", os.path.join(HERE, "score-server.mjs"), backup, cache, analyzer],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, cwd=os.path.join(HERE, "..", ".."))

    def ask(self, request: dict) -> dict:
        self.proc.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise RuntimeError("score-server exited")
        return json.loads(line)

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=60)


def pick_due(due: list[dict], n: int, seed: int) -> list[str]:
    """Most overdue first, Han words of 1-4 characters, then a seeded shuffle within the top 3n so
    successive stories get different sets."""
    words = [d["surface"] for d in due if d["surface"] and 1 <= len(d["surface"]) <= 4]
    pool = words[: 3 * n]
    random.Random(seed).shuffle(pool)
    return pool[:n]


def chat(llm, prompt: str, history: list | None = None, temperature=0.7, max_tokens=700):
    messages = [{"role": "system", "content": SYSTEM}] + (history or []) + [
        {"role": "user", "content": prompt}]
    t0 = time.perf_counter()
    out = llm.create_chat_completion(messages=messages, temperature=temperature,
                                     top_p=0.8, max_tokens=max_tokens)
    seconds = time.perf_counter() - t0
    text = out["choices"][0]["message"]["content"].strip()
    usage = out.get("usage", {})
    return text, seconds, usage, messages + [{"role": "assistant", "content": text}]


def summary(r: dict) -> dict:
    return {k: r.get(k) for k in ("runningWords", "known", "understood", "dueCount",
                                   "neverMetCount", "neverMetShare", "due", "neverMet")}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--backup", required=True)
    ap.add_argument("--cache", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--variants", default="plain,pool,revise")
    ap.add_argument("--n", type=int, default=10)
    ap.add_argument("--stories", type=int, default=3)
    ap.add_argument("--pool", type=int, default=400, help="known words offered, most frequent first")
    ap.add_argument("--length", type=int, default=300)
    ap.add_argument("--choose-from", type=int, default=20, help="due words offered to 'choose'")
    ap.add_argument("--threads", type=int, default=4)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)

    scorer = Scorer(args.backup, args.cache)
    words = scorer.ask({"words": True})
    known = sorted((k for k in words["known"] if k["rank"] is not None), key=lambda k: k["rank"])
    known_list = " ".join(k["surface"] for k in known[: args.pool])
    print(f"due now {len(words['due'])}, known {len(words['known'])}", file=sys.stderr)

    from llama_cpp import Llama
    t0 = time.perf_counter()
    llm = Llama(model_path=args.model, n_ctx=8192, n_threads=args.threads, verbose=False)
    load_s = time.perf_counter() - t0
    print(f"model loaded in {load_s:.1f} s", file=sys.stderr)

    out = open(os.path.join(args.out, "stories.jsonl"), "a", encoding="utf-8")
    try:
        for i in range(args.stories):
            due = pick_due(words["due"], args.n, seed=i)
            for variant in args.variants.split(","):
                fill = dict(length=args.length, due="、".join(due), known=known_list)
                if variant == "choose":
                    fill["due"] = "、".join(pick_due(words["due"], args.choose_from, seed=i))
                template = {"plain": PLAIN, "pool": POOL, "revise": POOL, "choose": CHOOSE}[variant]
                prompt = template.format(**fill)
                story, secs, usage, history = chat(llm, prompt)
                steps = [{"story": story, "seconds": round(secs, 1), "usage": usage,
                          "score": summary(scorer.ask({"text": story}))}]
                if variant in ("revise", "choose"):
                    for _ in range(2):
                        unknown = [w.split("×")[0] if isinstance(w, str) else w[0]
                                   for w in steps[-1]["score"]["neverMet"]]
                        if not unknown:
                            break
                        story, secs, usage, history = chat(
                            llm, REVISE.format(story=story, unknown="、".join(unknown),
                                               due=fill["due"]), history[1:])
                        steps.append({"story": story, "seconds": round(secs, 1), "usage": usage,
                                      "score": summary(scorer.ask({"text": story}))})
                asked = fill["due"].split("、")
                record = {"story": i, "variant": variant, "dueAsked": asked, "prompt": prompt,
                          "loadSeconds": round(load_s, 1), "steps": steps}
                out.write(json.dumps(record, ensure_ascii=False) + "\n")
                out.flush()
                last = steps[-1]["score"]
                print(f"story {i} {variant}: {len(steps)} step(s), "
                      f"{sum(s['seconds'] for s in steps):.0f} s, known {last['known']:.3f}, "
                      f"due {last['dueCount']}, never met {last['neverMetCount']}", file=sys.stderr)
    finally:
        out.close()
        llm.close()
        scorer.close()


if __name__ == "__main__":
    main()
