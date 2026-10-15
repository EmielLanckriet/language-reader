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

## The phrase table (#15), 2026-10-16

Reader now teaches pinyin-pro a table of phrases (`src/lib/analyzer/pinyin-phrases.ts`): 长得, 还钱,
得去, verb + 得 complements, adverbial 地 (慢慢地, 高兴地), 教 + object, 为人, 和面, 有空 and a
few more. pinyin-pro's own words lose to custom phrases (种花 would turn 这种花 into zhòng), so
every entry must be a phrase with only one reading. `heteronyms.tsv` (129 lines, Claude-labelled)
puts each heteronym in both readings, so an entry that breaks the other reading shows up there;
CPP checks the rest.

```bash
node scripts/compare-pinyin/score-tsv.mjs scripts/compare-pinyin/everyday.tsv scripts/compare-pinyin/heteronyms.tsv
RAW=1 node scripts/compare-pinyin/score-tsv.mjs …   # pinyin-pro without the table
QUIET=1 node scripts/compare-pinyin/score-tsv.mjs <cpp.tsv>  # test.sent and test.lb pasted side by side
```

| | pinyin-pro | with the table |
| --- | ---: | ---: |
| everyday (30) | 22 | 29 |
| heteronyms (129) | 92 | 118 |
| CPP test (10,254) | 9,282 | 9,283 (none broken, one fixed) |

The table was written looking at both small sets, so they show what it fixes, not a fair accuracy;
CPP is the independent check. Still wrong: 还 with a pronoun object (还我书), sentence-final 还
(欠钱不还), 得 děi before most verbs (你得多吃点), 种过花, 背着书包; these need context a phrase
cannot carry. 说服 stays shuō, as pinyin-pro and some current references read it. Neutral tone
is scored as 5 (pinyin-pro writes 0). Applying the table took 17 ms on the laptop, once per page.
