# Offline translation comparison

Measured 2026-09-30. **Mozilla is a promising faster quick translator, but none of the three engines demonstrated consistently reliable English on this sample. ML Kit does not justify a native Android integration on quality alone.** No production translation behavior changed and the physical phone was not used.

[Inspect every translation side by side](../scripts/compare-translators/results/comparison.html). [Raw results and model hashes](../scripts/compare-translators/results/manifest.json) and [reproduction notes](../scripts/compare-translators/README.md) are retained with the harness.

## Sample and method

The corpus contains the first 20 retained Chinese subtitle cues from each of two existing tariff and cooking fixtures, plus 16 joined groups made from those same cues: 56 inputs, not 56 independent examples. Joining concatenates the original cue text with a final Chinese full stop. It does not add internal punctuation or correct transcription. The last tariff group is still an incomplete sentence. Cooking contains apparent transcription errors, including 加重菜 and 切掉地; their resulting mistranslations cannot fairly be attributed solely to the translation model.

Each main engine translated all 56 inputs twice, sequentially, with the same frozen corpus. All three produced identical text across their two rounds. Timings below use the second round, exclude model download, and measure each translation call. Engine processes ran one at a time, after builds. This is a small exploratory run, not a statistically controlled performance study or a blinded human quality evaluation. There is no reference translation set or BLEU score.

OPUS uses Reader's actual tokenizer and greedy decoder, q8 Xenova OPUS-MT zh-en weights, and ONNX Runtime Web 1.30.0 WASM with one thread. Mozilla uses its zh-Hans–en model version 2.1 with Bergamot npm 0.4.9, one WASM worker and its result cache disabled. Both run under Node 24.20.0 on an AMD Ryzen 7 PRO 4750U Linux laptop. Browser overhead and mobile performance were not measured.

ML Kit translate 17.0.3 runs in a separate minimal Android app on an Android 15/API 35 x86_64 emulator. After downloading its language model, Wi-Fi and mobile data were disabled and Android reported no active default network. All 112 translations completed. Network settings were restored afterward. SDK internal caching was not controlled. The benchmark app never touched Reader's data.

## Speed, storage and memory

| Engine | Median/input | 95th percentile | Total, 56 inputs | Memory observed |
| --- | ---: | ---: | ---: | --- |
| Reader OPUS, laptop WASM | 359 ms | 1,003 ms | 23.75 s | 826 MiB peak process RSS |
| Mozilla, laptop WASM | 27 ms | 87 ms | 2.08 s | 785 MiB peak process RSS |
| ML Kit, Android emulator | 44 ms | 108 ms | 2.92 s | 113 MiB maximum sampled app PSS |

Mozilla completed the second pass about **11.4× faster** than Reader OPUS on this laptop. Initial OPUS session loading took 1.78 s; Mozilla loading plus a greeting warmup took 1.66 s. These startup measurements have different boundaries. ML Kit's first translation includes lazy initialization; it is not a separate model-load measurement.

Memory columns are **not directly comparable**: desktop peak RSS includes the Node process and WASM workers, while Android PSS apportions shared pages and was sampled only after translation calls. Neither is incremental model RAM or a physical-phone safety result. Mozilla's smaller model did not produce a large reduction in desktop peak process memory with this configuration.

OPUS encoder and decoder files total 113.1 MB; tokenizer JSON adds 6.4 MB. Mozilla model, vocabulary and shortlist total 54.6 MB. ML Kit's downloaded en_zh model directory occupied approximately 43.3 MiB of allocated disk space, including shared/bidirectional files; native SDK binaries are additional. Disk size, download compression and runtime memory are different quantities.

## Meaning checks

These are qualitative observations of the recorded outputs, not a comprehensive accuracy score.

| Input / intended meaning | Reader OPUS | Mozilla | ML Kit |
| --- | --- | --- | --- |
| 我是王刚 — “I am Wang Gang” | “I'm Wang Kong.” | “I am King Gang.” | Correct name |
| 都白整了吗 — “Was it all for nothing?” | Preserves the meaning | “Are they all white?” | “Are you more than white?” |
| Joined court passage: rhetorical question saying the court ruled Trump's tariff policy illegal | Preserves the ruling, though changes “this February” to “last February” | Says it **did not** find the policy illegal, reversing the intended meaning | Loses Trump and tariff policy; malformed question |
| Joined bowl/eggs/vinegar passage: three eggs and one gram of white vinegar | Preserves quantities | Preserves quantities, awkward English | Changes **three eggs to two** and drops the gram |
| Joined ripe-tomato instruction | Drops ripeness | Preserves two ripe tomatoes | Changes ripe tomatoes to cherry tomatoes |
| Long cooking/frying group | Garbled cooking instructions | Garbled cooking instructions | Garbled cooking instructions |

Context helps selectively. Joining the court cues lets OPUS recover a meaning absent from “Not Trump.” Translating longer groups is not a general cure: Mozilla still reverses that ruling, and all three struggle with the longest cooking instructions. Very short chunks also lack enough context for an unambiguous translation.

An additional OPUS run used Transformers.js 4.3.0 with three beams and the same q8 weights. It retained the wrong speaker name, the confusing frying passage and most other weaknesses; it did not demonstrate a compelling improvement. This changes both decoding implementation and execution backend (native CPU), so its timings are excluded from the main comparison and it is not a pure isolated beam-search experiment.

## Recommendation

1. **Do not migrate to ML Kit just to obtain the Google Translate quality you like.** Google documents that it uses the Translate app's *offline* models, and recommends evaluating quality for each use case. This sample does not support assuming parity with online Google Translate. Native Android integration would also add a new bridge to the PWA.
2. **If we continue with a small offline translator, Mozilla is the next candidate for a bounded quick-translation prototype.** It offers a substantial measured speed advantage, not a demonstrated general quality upgrade or low-memory guarantee. First investigate its WASM memory allocation and test a larger, varied set of complete sentences on the laptop.
3. **Improve sentence boundaries before choosing a replacement.** Retain cue alignment while translating sensible sentence units; the experiment shows why raw subtitle fragments are troublesome. The grouping strategy itself still needs evaluation.
4. **Do not claim the heavy LLM is replaceable at the same quality from this comparison.** It was not rerun here. A product choice to accept rough offline English could remove that workload, but reliable explanatory English remains unresolved by these results.

## Primary sources

- [Google ML Kit translation capabilities and limitations](https://developers.google.com/ml-kit/language/translation): offline operation, relationship to Google Translate offline, and quality limitations.
- [ML Kit Android integration](https://developers.google.com/ml-kit/language/translation/android).
- [Bergamot translator runtime](https://github.com/browsermt/bergamot-translator).
- [Mozilla live model registry](https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records): exact selected attachment records and SHA-256 hashes are retained in `mozilla-model.json`.
- [Xenova OPUS-MT zh-en](https://huggingface.co/Xenova/opus-mt-zh-en): local file digests are retained in the measurement manifest; the upstream revision of the previously cached weights was not recorded.
