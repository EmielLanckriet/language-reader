# ADR-0015: The Contextual Segmenter Is Fetched On Demand, Not Installed

**Status**: Accepted
**Date**: 2026-09-03
**Relates to**: ADR-0011, ADR-0012, ADR-0014, Constitution Principle V (dependencies), Principle I,
spec `003-real-segmentation` FR-032 to FR-035

## Context

ADR-0014 gave the reader its own word list because the platform had none. That fixed ordinary words
— 朋友, 自行车, 玛丽亚 — and left a class it cannot fix. Reported from the phone: 你是哪国人 comes
back as 你 · 是 · 哪 · **国人**. The dictionary is right that 国人 is a word; it is wrong that it is
this word, and no dictionary can tell the difference, because only the sentence around it decides.

The cheap rung was measured before being rejected. A frequency-weighted maximum-probability path
over jieba's dictionary — 1.6 MB gzipped, the approach the register called the next lever — returns
**the same wrong answer**: 你 · 是 · 哪 · 国人. It is context-free by construction, so it returns one
answer for a character sequence wherever it appears. It does fix 结婚的和尚未结婚的人 and improve
三个人, and it does not touch the case that prompted this.

A contextual tagger fixed all three. Measured, on the seven sentences this slice has been arguing
about, `bert-base-chinese-ws` quantised to int8 got **all seven** right; the dictionary gets four.

Sizes were measured rather than assumed, and the register's estimate was wrong. It expected a
"tiny Chinese BERT, 4 layers, 256 hidden, roughly 10–30 MB". No such published model exists for
Chinese segmentation. What exists:

| | Download | Correct of 7 |
|---|---|---|
| Dictionary alone (ADR-0014) | 0.43 MB | 4 |
| `albert-tiny-chinese-ws`, int8 | 7.4 MB | 4 — **breaks** 自行车 |
| `albert-tiny-chinese-ws`, fp32 | 14.1 MB | 5 |
| `bert-tiny-chinese-ws` | 11–44 MB | 3 — breaks 结婚, invents 国学习 |
| **`bert-base-chinese-ws`, int8** | **98 MB** (see below) | **7** |
| ONNX runtime (any of the above) | 3.15 MB | — |

Quantisation is not free: int8 cost albert-tiny the compound 自行车 that its fp32 form gets right.

**A correction to those figures, found by checking rather than computing.** The download column was
first written from gzipped sizes measured locally — 74 MB for the model. The model's host serves
`.onnx` **uncompressed**: requested with `Accept-Encoding: gzip`, it answers 102,904,192 bytes and
no `Content-Encoding`. So the real cost is about 98 MB for the model plus roughly 3 MB for the
gzipped runtime — **about 100 MB, not 79** — and the decision was taken against the lower number.
It does not change which option wins on quality, and it does change the price, so it is recorded
here rather than left as a pleasant assumption.

## Decision

**Ship the 98 MB int8 `bert-base-chinese-ws`, and fetch it on demand rather than installing it.**

- The **install** stays at 2.6 MB and always includes the dictionary, so the reader can read
  immediately and offline without downloading anything further.
- The **model** is offered on the diagnostics view, with its price stated, and downloaded once into
  the Cache API. Every later start finds it there, offline included.
- The **runtime** — onnxruntime-web's WebAssembly, 14 MB on disk — sits in the build but is
  excluded from the precache list, because it is useless without the model. It is downloaded *with*
  the model, into the same cache, and served from there by the service worker. The two are either
  both on the device or neither is, which is also what the "is it downloaded" check reports.
- **Install cost is therefore redefined as precached bytes, not build bytes.** They were the same
  thing until now. Counting the build would report a cost nobody pays.
- When the model arrives, it is simply a different analyzer with a different version, so every
  document becomes stale and re-derives through the machinery ADR-0011 and the catch-up sweep
  already provide. No migration, no special case.

## Alternatives Rejected

- **Frequency weighting instead** (1.6 MB). Rejected on measurement: it returns the same wrong
  answer for the case that prompted this. It remains available and would compose.
- **`albert-tiny` fp32** (14 MB, 5 of 7). Genuinely tempting: small enough to precache, which would
  have removed the on-demand download, the runtime split, and the redefinition of install cost —
  a materially simpler thing to own. Rejected because it leaves 三个人 and 和尚 wrong, and the
  developer's judgement was that segmentation quality is the point of the project.
- **`albert-tiny` int8** (7.4 MB). Rejected: quantisation breaks 自行车, so it is no better than the
  dictionary while costing seventeen times more.
- **Transformers.js** rather than onnxruntime-web plus our own tokenizer. Rejected under Principle
  V: it brings a tokenizer framework, a model loader and a pipeline abstraction, and a Chinese BERT
  tokenizer is one lookup per character. The vocabulary is 107 KB and committed.
- **Precaching the model.** Rejected: about 100 MB before first use, on a phone, for a reader who
  may never want it.
- **Hosting the model ourselves.** Rejected: 98 MB in git is permanent, and the repository holds
  code only. It is fetched from the model's own public host, which we neither run nor pay for —
  consistent with ADR-0007.

## Consequences

**Easier.** Segmentation is finally correct on the cases that motivated the slice. The reader who
does not want a 74 MB download loses nothing they had.

**Harder, and worth naming.** There are now three analyzers and two quality levels, so "which
analyzer produced this" is a real question — which is exactly why ADR-0011's behavioural version
exists, and it now earns its keep twice. 

The runtime is a second thing that must be on the device for offline use. The first design cached it
lazily, on first use, which left a hole: download on wi-fi, go offline, and the reader holds a 98 MB
model without the 3 MB of runtime that executes it — having paid the whole price for dictionary
segmentation. Closed before shipping rather than logged as a known gap: the runtime is fetched with
the model, kept in the same cache, served from it by the service worker, discarded with it, and the
"is it downloaded" check requires all of it. Either the whole capability is present or none of it
is.

**A new dependency.** `onnxruntime-web`, justified as Principle V requires: there is no other way to
run an ONNX model in a browser, and the alternative framework is strictly larger for strictly less
control.

**Revisit if**: a small Chinese segmentation model good enough to precache appears, which would
collapse this whole design back to one analyzer and one install; or if the reader finds the download
is never worth it in practice, which would make ADR-0014's dictionary the end state.
