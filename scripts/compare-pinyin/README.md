# Heteronym (多音字) pinyin measurement

Laptop-only research harness comparing Reader's pinyin-pro (3.29.4, the whole-text call in
`src/lib/analyzer/pronounce.ts`) with g2pM and g2pW. Measured 2026-10-03; findings are summarized in
`docs/backlog.md` under "Pinyin for heteronyms". Nothing ships from here.

Data: the CPP benchmark (`github.com/kakaobrain/g2pM`, `data/test.sent` and `test.lb`; polyphone marked ▁X▁)
and `everyday.tsv`, 30 short spoken-style sentences labelled by Claude, including the five errors recorded in the
backlog. `cpp1k` is every tenth CPP test line (1,026). g2pM and g2pW were trained on CPP's training split;
pinyin-pro was not, so CPP favours them.

```bash
node scripts/compare-pinyin/run-pinyin-pro.mjs <file.sent> scripts/compare-pinyin/results/<stem>-pinyin-pro.json
# Python 3.12 with: g2pM g2pw requests torch (CPU); g2pW downloads G2PWModel/ (607 MB) into the working directory
python run-g2p.py <file.sent> scripts/compare-pinyin/results
LABEL_DIR=<dir with cpp.lb, cpp1k.lb> python3 scripts/compare-pinyin/score.py
```

| Engine | CPP test (10,254) | CPP subset (1,026) | Everyday (30) | Size |
| --- | ---: | ---: | ---: | --- |
| pinyin-pro (current) | 91.1% | 90.8% | 22 | in the app bundle |
| g2pM | 97.3% | 97.0% | 20 | 1.6 MB numpy weights |
| g2pW, pip default model | not run in full | 85.4% | 28 | 607 MB ONNX (BERT-base) |

The pip g2pW model follows **Taiwan** readings (和 hàn, 意识 yìshì, 尽管 jìnguǎn, 差不多 chā) and mishandles
simplified 干 (干部 gān), which explains its CPP score far below the paper's 99.08% from a CPP-trained
checkpoint. It took about 0.4 s per CPP sentence on CPU in Python. It is the only engine that got all five
backlog errors right (长得, 还钱, 得去, 跑得快, 说服). g2pM got none of those five. The everyday set is far too small for
more than a direction.
