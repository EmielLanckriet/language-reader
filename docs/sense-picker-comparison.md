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

## One video's words, Qwen3-1.7B against Qwen3-8B

Measured 2026-10-16 for [#16](https://github.com/EmielLanckriet/language-reader/issues/16). **On the reader's scope in one native video, Qwen3-1.7B picked an acceptable sense for 40 of 45 hand-labelled words. That is 3 more than the sense the word sheet already shows first, and the whole-scope estimate is about 83% (85% with trimmed options), so it does not clearly reach 85%. Qwen3-8B got 44 of 45, about 95% over the whole scope, at roughly 5 s per word and 8 GB of memory on the laptop.** Neither model's "misheard" suggestion is usable. No production behavior changed and the phone was not used.

### Question and method

The video is 探访草原深处，我们拍到了…… (影视飓风, 712 s, Tibetan Gansu, unscripted speech with professional subtitles), imported 2026-10-03 after a week of reading. It was segmented as the phone does: the shipped BERT tagger (the segmenter harness's mirror of it) plus the reader's 22 corrections. These tokens matched 280 of the reader's 313 taps in this document. The rest were taps made before or during corrections, such as 乾崑智. The CC-CEDICT longest-match segmenter matched only 220.

The scope is the reader's own (2026-09-28): words new or hard at import, plus every word missing from CC-CEDICT, once per word per document. Here, at the import time:

- **new**: no mark, no lookup, check, review or Anki example, and never inside a played range of another document;
- **hard**: looked up at least once, or graded Again in a review;
- **missing**: no CC-CEDICT headword equal to the word.

334 of the 629 distinct words are in scope: 94 with one sense, 173 with two or more, 67 missing. "New" includes common words such as 这些 and 有点 that the reader never marked or played before this video. Nothing in the data says they are known. Each word's context is its subtitle line with one line either side.

Options are the CC-CEDICT senses in file order, split at `/`, as in the comparison above and as the issue proposes. The word sheet shows the same senses grouped by entry. Prompt, `Answer:` prefill and letter probabilities are unchanged, forced choice only. 45 of the 173 multi-sense words were drawn at random (seed 16). **Claude labelled them before seeing any output; the reader has not reviewed them.** Gold sets are permissive where CC-CEDICT splits one meaning across near-synonyms. 29 of the 45 are "non-trivial": the gold set leaves out at least one real sense.

For the 67 missing words there is nothing to choose from. Each model wrote a gloss of at most 40 tokens, greedy. It was asked to name the intended word if the text looked misheard. 20 of these glosses were judged by hand.

Candidates: Qwen3-1.7B Q4_K_M (the same file as above, same sha256), plain and with `--trim`; Qwen3-8B Q4_K_M (`unsloth/Qwen3-8B-GGUF`, 5.0 GB). Both ran on llama.cpp b11374 with 4 threads, one round, no prompt cache. Other jobs shared the laptop, with a load average of 4–5 and 6–8 during the trimmed run. Timings are therefore pessimistic.

### Results

| 45 labelled words | Qwen3-1.7B | 1.7B, trimmed | Qwen3-8B | First sense the sheet shows | First listed sense | Chance |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| all | 40 | 41 | **44** | 37 | 34 | 26.0 |
| non-trivial (29) | 25 | 25 | **28** | 22 | 20 | 12.5 |

"First sense the sheet shows" applies `gloss.ts` `ranked()` without the in-context reading. With the reading, it might do slightly better.

On 45 items the 95% intervals are wide: 40/45 is 77–95%, 41/45 is 79–97%, and 44/45 is 88–100%. To use the rest of the scope, every unlabelled word where the two models disagreed (52, excluding 诶, whose options are all variant lines) was judged by hand. 1.7B's pick was acceptable in 30 and 8B's in 47. Where they agreed (75 words), the pick was counted right at the labelled rate (28 of 29 agreed picks right). One known exception is 打 in 打篮球, which both read as "to hit". **Whole-scope estimates for the 172 scorable multi-sense words: 1.7B about 83%, 1.7B trimmed about 85%, 8B about 95%.**

| | Qwen3-1.7B | Qwen3-8B |
| --- | --- | --- |
| Forced choice, median / 95th percentile per word | 1,146 / 2,185 ms (trimmed 986 / 1,710) | 5,063 / 10,253 ms |
| Gloss for a missing word, median / 95th percentile | 2,519 / 3,011 ms | 9,403 / 12,096 ms |
| Model load | 2.6 s | 10.2 s |
| Peak process memory (RSS) | 4,332 MiB | 8,006 MiB (glosses 8,402) |
| One video like this (173 choices + 67 glosses) | about 6 min | about 25 min |
| Mean top probability, right / wrong | 0.93 / 0.98 | 0.94 / 0.99 |

1.7B's peak RSS is higher than the 3,039 MiB measured on 2026-10-03 with the same file and binary. The cause was not investigated; memory was under pressure from other jobs.

| 20 missing words, gloss usable | Qwen3-1.7B | Qwen3-8B |
| --- | ---: | ---: |
| usable meaning in context | 15 | 18 |
| claims "misheard or mistyped", all 67 words | 33 | 51 |

### Observations

**The 1.7B model's gain over the sheet is small, and its errors are the kind a reader notices.** It picked 手 "convenient" for 洗个手, 投 "to throw oneself into (a river)" for a basketball shot, 新年 as its classifier line, 的 as a nominaliser in 去到的地方, 什么 "something" in 是什么意思, 名 "name" in 一名阿姨, and 睡 "to lie down". The sheet's current ordering already avoids several of these. Trimming non-meaning lines (`variant of`, `CL:`) fixed 新年, 佛 in the pun 佛BA, 帮, and 打 in 打篮球. It did not fix the rest.

**8B errs mostly where CC-CEDICT has no fitting sense.** Examples are 三分 (three-pointer), 半 in 半个月 and 那么 in 睡那么香. Its other misses were 中 as "China" in 藏语中 and 驾 as "ride". Both models read 得了 in 洗个手得了 as de2 liao3 "possible" rather than "and be done with it". On 5 of 173 prompts, 8B put under half its probability on the option letters. Its picks there were still sensible.

**Probabilities still do not separate right from wrong** for either model, as above.

**Missing words in this video are rarely errors.** By hand, the 67 missing words break down as:

- 15 verb-plus-complement or verb-plus-给 forms (做出来, 转发给, 准备好);
- 12 names, brands and titles (阿维塔, 洛克, 样片 as in 样片日记);
- 10 rare words, slang, puns and idioms (单押, 诳球 for 诳语, 闲庭信步);
- 8 common combinations (很多, 来说, 像是);
- 7 Tibetan or regional terms (煨桑, 隆达, 藏袍);
- 7 reduplications or A-not-A forms;
- 5 numbers;
- 3 segmentation errors (乾崑智, 驾给, 撒隆达).

None is a misheard subtitle, so this video does not test the 新资 case. Both models gloss ordinary compositional forms well. Neither explained 隆达 (prayer flags) or the segmentation error 驾给 (智驾|给). 1.7B read 四五 as "forty-five".

**The "misheard" suggestion is harmful as asked.** It fired on half (1.7B) and three quarters (8B) of the missing words in a video with none. 8B's "intended" words would mislead: 插箭节 → 插秧节, 牦牛奶 → 黄油牛奶, 完代 (a name) → 完蛋, 诳球 → 诓骗.

### Recommendation

1. **Do not build the 1.7B picker into translate.py on this evidence.** It falls short of the reader's 85% bar on the scope (about 83%, 85% trimmed, interval on the sample 77–95%). It adds about 3 correct words in 45 over what the sheet already shows. If it is built later, use trimmed options and show the pick as an ordering, not as the answer.
2. **Qwen3-8B is accurate enough for a background laptop pass** (ADR-0023): about 95% on the scope, about 25 minutes per video of this size on 4 threads. It needs 8 GB, so one model at a time. Its glosses for missing words are usable (18 of 20) if marked as guesses. Drop the "intended word" request, or keep it out of the sheet, until it is measured on a video with real recognition errors.
3. **Before quoting either figure as settled:** the reader reviews these 45 labels, and a second video with real recognition errors (the 上海 street interview) tests the misheard case.
