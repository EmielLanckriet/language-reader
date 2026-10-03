# Sense picker comparison

Measured 2026-10-03. **Qwen3-1.7B, the model Termux already has, picks the right CC-CEDICT sense for about 70% of words when it must choose among real senses, far above trivial baselines. It cannot be trusted with escape options: offered "none of these fits", it picks that for most words. Laya multilingual, an open Jev-style decision model, is ten times faster but barely better than always taking the first listed sense, and its confidence carries no signal.** No production behavior changed and the phone was not used.

[Every pick side by side](../scripts/compare-senses/results/comparison.html). [Raw results and model hashes](../scripts/compare-senses/results/manifest.json) and [reproduction notes](../scripts/compare-senses/README.md) are retained with the harness.

## Question and method

Can a small local model answer "which dictionary sense of this word is meant in this sentence?" in one forward pass, returning a probability per option, without generating text? That is the shape of TypeSafe's Jev, which is API-only; several open reproductions appeared in September 2026.

42 items come from the 16 joined tariff and cooking sentences of the [translation comparison](offline-translation-comparison.md). 34 are words a reader might look up (白 in 白整 "in vain", 道 as a dish classifier, 成 in 四成热 "tenths", 将 as an object marker). 8 were added to test non-sense answers: name fragments (刚 in 王刚, 特 in 特朗普), parts of longer words (白 in 白醋, 熟 in 熟透, 期 in 本期), an ASR error (加重 for 家常菜), a dictionary gap (滚刀, which CC-CEDICT only knows as a gear hob) and a compositional use (翻过 in 翻过来). Options are every CC-CEDICT sense of the marked headword, in file order, with pinyin: 1 to 18 per word.

**Gold answers were labelled by Claude and have not yet been reviewed by the reader.** Where CC-CEDICT splits one meaning across near-synonyms, several senses are accepted.

Three variants share the items:

- **forced**: senses only. Items with no acceptable sense (name fragments, 哈, the ASR error) are run but unscored.
- **none**: plus "none of the listed senses fits".
- **meta**: plus "not a whole word here (part of a longer word, name or expression, or cuts across words)" and, for multi-character words, "its characters' meanings combined".

Candidates:

- **Qwen3-1.7B Q4_K_M** through llama.cpp server b11374, CPU. Options are lettered; the reply is prefilled with `Answer:` and the probability of each letter as the next token is read and renormalized. Without the prefill the model starts "The sentence is…" and the letters hold almost no probability, which first made results meaningless.
- **Laya multilingual** (mmBERT-base, 322M parameters, Apache-2.0) through `@receptron/laya` 0.1.2 on ONNX Runtime. Only the English checkpoint is published as ONNX; the multilingual one was exported with the package's own script, and the package's hardcoded English special tokens had to be patched. After the patch its output matched the Python reference exactly on five items.

Each engine used 4 threads, on an AMD Ryzen 7 PRO 4750U laptop with little other load, and ran every item twice. Both gave identical picks across rounds.

## Results

| Variant | Qwen3-1.7B | Laya multilingual | Always first sense | Chance |
| --- | ---: | ---: | ---: | ---: |
| forced | **26 / 37** | 16 / 37 | 10 | 8.8 |
| none | 14 / 40 | 13 / 40 | 10 | 8.5 |
| meta | 12 / 42 | 9 / 42 | 10 | 8.4 |

| | Qwen3-1.7B | Laya multilingual |
| --- | --- | --- |
| Median / 95th percentile per word, forced | 1,484 / 2,759 ms | 155 / 256 ms |
| Weights on disk | 1.1 GB (already on the phone) | 1.29 GB fp32 (unquantized) |
| Peak process memory (RSS) | 3,039 MiB | 2,383 MiB |
| Mean top probability, right / wrong (forced) | 0.96 / 1.00 | 0.35 / 0.46 |

42 items cannot give a precise accuracy; one item is about 2.7 percentage points. The differences between Qwen forced and everything else are large enough to matter; differences of a few items are not.

## Observations

**Qwen, forced choice, mostly picks what a learner needs.** It got 白 "in vain", dialect 整 "to do", 咱 as inclusive "we", 打入 "crack (an egg) into", 将 as the 把-like object marker and 即可 "and that will suffice". Its errors are often understandable near-misses: 块 as a classifier rather than "chunk", 熟 as "cooked" rather than "ripe". Some are plain mistakes: 成 in 四成热 as "to become", 开 小火 as "to open", 道 as "a skill".

**Escape options break Qwen.** With "none" available it chose it 28 times out of 40, almost always with probability near 1, including for 收 "to collect" and 开 "turn on". The meta options did not help: it flagged name fragments as "none" rather than "not a whole word", and marked 翻过 as a segmentation error. Detecting a bad segmentation or a dictionary gap is not something this model does reliably through an option.

**Qwen's probabilities do not separate right from wrong.** It is just as confident when wrong. A UI could not use them to decide when to show a single answer; ranking still has value, since the correct sense is usually present in the list.

**Laya does not understand this task.** It is only modestly above the first-sense baseline under forced choice, and makes errors no reader would: 将 as "(Chinese chess) general", 切 as "definitely", 那 as "how". It is more confident when wrong. In the meta variant it correctly flagged 特 and 滚刀 but also flagged 判, 收, 块 and 加 as not whole words. This is consistent with its model card: the multilingual checkpoint was fine-tuned on English business workflows. Its speed is real.

## Smaller and cheaper Qwen runs

A follow-up the same day tried to make Qwen cheaper, on the forced variant only. "Sentence first" puts the unmarked sentence at the start of the prompt and keeps llama.cpp's prompt cache, so words from one sentence reuse it; "trimmed" drops surname, variant, cross-reference, pronunciation, classifier-list and abbreviation senses (27 of 299 options, no gold lost) and example lists. Figures are first-round (first lookup); this llama.cpp version also caches whole earlier prompts across requests, which makes second-round timings with the cache meaningless. Load rose during the final runs.

| Configuration | Correct | Median per word | Prompt tokens evaluated, median |
| --- | ---: | ---: | ---: |
| Qwen3-1.7B, original prompt | 26 / 37 | 1,488 ms | 157 |
| Qwen3-1.7B, sentence first | 26 / 37 | 1,414 ms | 146 |
| Qwen3-1.7B, sentence first, trimmed | 27 / 37 | 1,341 ms | 137 |
| Qwen3-0.6B Q4_K_M (0.38 GB), original prompt | 13 / 37 | 552 ms | 157 |
| Qwen3-0.6B, sentence first, trimmed | 18 / 37 | 499 ms | 140 |

The per-word option list dominates the prompt, so reusing the sentence saves only about 5% and trimming about another 5%. The 0.6B model is three times faster but falls most of the way back to the first-sense baseline (10). Neither change makes per-tap sense picking cheap; the remaining routes are background precomputation with the 1.7B model, or a small model trained for this task with these items as its test set.

## Zero-shot bi-encoder

Also on 2026-10-03: a bi-encoder compares a context vector with one vector per gloss, so gloss vectors could be computed once on the laptop and shipped, and one sentence encoding serves every word in it. Without any training, on the forced variant (`run-embed.py`, PyTorch fp32 CPU, 4 threads):

| Model | Whole marked sentence | Target word's own vector | Context encoding, median |
| --- | ---: | ---: | ---: |
| BAAI/bge-m3 (568M) | 18 / 37 | 21 / 37 | 156 ms per sentence |
| multilingual-e5-small (118M) | 13 / 37 | 16 / 37 | 17 ms per sentence |

bge-m3 reading the word's own vector gets more than halfway from the first-sense baseline (10) to Qwen (26–27) with no task training. The 2025 distillation work ([Ming et al., EMNLP 2025](https://aclanthology.org/2025.emnlp-main.45/), English and WordNet) trained a 406M model on LLM-labelled corpus sentences and matched its DeepSeek-v3 teacher; the same recipe applied to a bi-encoder over CC-CEDICT is the plausible route to a fast, accurate picker.

## Recommendation

1. **Do not adopt Laya or similar Jev-style encoders for sense picking** without a version fine-tuned for this task. Its speed would matter only if it were accurate.
2. **A Qwen forced-choice sense ranking is worth a bounded prototype as an optional, slower annotation**, alongside the existing dictionary popup. It reuses the downloaded translation model, and could order senses or highlight the likely one while still showing the rest. Do not show its pick as authoritative, and do not offer it a "none" option.
3. **Before that, measure on the phone and with reviewed labels.** 1.5 s per word on the laptop says nothing certain about the Samsung A71. Thermal validation of the phone remains open, so this should wait for it. A larger, reviewed item set is needed before quoting an accuracy.
4. **Detect segmentation errors and dictionary gaps another way**, for example from segmenter disagreement or from the absence of a dictionary entry, rather than by asking this model.
