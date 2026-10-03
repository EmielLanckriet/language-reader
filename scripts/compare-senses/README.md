# Sense picker measurement

See [findings](../../docs/sense-picker-comparison.md) and [every pick](results/comparison.html). This is a standalone research harness, not production integration. Run from the repository root. Models, runtimes and downloaded dependencies are not committed.

The question: given a sentence and a marked word, can a small local model choose the right CC-CEDICT sense in one forward pass, with a probability for every option? Two candidates:

- **Qwen3-1.7B Q4_K_M**, the model Termux already downloads for translation, through `llama-server`. The prompt lists the options as letters and prefills `Answer:`; the probability of each letter token is read from the first position and renormalized over the valid letters. Nothing else is generated.
- **Laya multilingual** (mmBERT-base, 322M), an open-source Jev-style typed-decision model, through `@receptron/laya` on ONNX Runtime.

## Setup

Use Node 24. In a disposable directory `$BENCH`:

```bash
npm install --prefix $BENCH @receptron/laya@0.1.2
curl -fL https://github.com/ggml-org/llama.cpp/releases/download/b11374/llama-b11374-bin-ubuntu-x64.tar.gz | tar xz -C $BENCH
curl -fL https://huggingface.co/unsloth/Qwen3-1.7B-GGUF/resolve/main/Qwen3-1.7B-Q4_K_M.gguf -o $BENCH/qwen3-1.7b-q4.gguf
```

Only the English Laya checkpoint is published as ONNX (`receptron/laya-onnx` has no `multilingual/` folder despite its README). Export the multilingual one with the package's script, from a clone of `github.com/receptron/laya` at commit 6478649:

```bash
cd laya/export
uv venv -p 3.12 .venv
uv pip install -p .venv/bin/python --index-url https://download.pytorch.org/whl/cpu torch
uv pip install -p .venv/bin/python transformers safetensors onnx onnxscript onnxruntime huggingface_hub
.venv/bin/python -c "from huggingface_hub import snapshot_download; snapshot_download('convaiinnovations/laya', local_dir='hf', allow_patterns=['multilingual/*','rl_common.py','rl_agent_api.py'])"
cp hf/rl_common.py hf/rl_agent_api.py hf/multilingual/
.venv/bin/python export_onnx.py hf/multilingual $BENCH/onnx-multilingual
```

`@receptron/laya` 0.1.2 hardcodes the English model's `[CLS]`, `[SEP]`, `[MASK]` and `[PAD]`; mmBERT's are `<bos>`, `<eos>`, `<mask>` and `<pad>`. In `$BENCH/node_modules/@receptron/laya/dist/laya.js`, make `Laya.load` take them from `tokenizer/tokenizer_config.json` (`cls_token`, `sep_token`, `mask_token`, `pad_token`), as the Python reference does. With that patch, probabilities matched the Python `RLAgent.system_one` exactly on five items, including the 19-option one.

Match the hashes in `results/manifest.json` for the measured weights.

## Run

```bash
python3 scripts/compare-senses/make-items.py        # only after changing labels
node scripts/compare-senses/run-qwen.mjs $BENCH/llama-b11374/llama-server $BENCH/qwen3-1.7b-q4.gguf scripts/compare-senses/results/qwen.json
node scripts/compare-senses/run-laya.mjs $BENCH $BENCH/onnx-multilingual scripts/compare-senses/results/laya.json
node scripts/compare-senses/report.mjs $BENCH/qwen3-1.7b-q4.gguf $BENCH/onnx-multilingual
```

Run engines sequentially. Each runs every item twice in each variant; the report uses the second round.

`run-qwen.mjs` also takes `--name`, `--variants forced`, `--trim` and `--sentence-first` (see the file header); the `results/speed-*.json` runs used them with `qwen3-1.7b-q4.gguf` and `Qwen3-0.6B-Q4_K_M.gguf` from `unsloth/Qwen3-0.6B-GGUF`. With `--sentence-first`, read the first round: llama-server keeps earlier prompts cached across requests, so the second round re-evaluates almost nothing.

Zero-shot bi-encoders (bge-m3, multilingual-e5-small; forced variant only): `python run-embed.py <hf-cache-dir> scripts/compare-senses/results` with PyTorch (CPU) and transformers, writing `results/embed-*.json`.

## Data and interpretation

`items.json` is generated and self-contained: sentence, marked word, all CC-CEDICT senses in file order, and acceptable answers. The labels in `make-items.py` were written by Claude and are not yet reviewed by the reader. Some gold sets are deliberately permissive where CC-CEDICT splits one meaning across near-synonyms.

Three variants share the items. **forced** offers only the senses. **none** adds "none of the listed senses fits". **meta** also adds "not a whole word here" and, for multi-character words, "its characters' meanings combined". An item with no acceptable answer in a variant (for example a name fragment under forced choice) is run but not scored.

The sentences are the 16 joined groups from `scripts/compare-translators/corpus.json`: two topics, with ASR errors kept. 42 items is far too few for a precise accuracy; it can show gross failure modes and speed. Laptop timings with other load present; no phone, browser or battery measurement is claimed.
