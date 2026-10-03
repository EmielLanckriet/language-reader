"""Usage: <python with g2pM, g2pw> scripts/compare-pinyin/run-g2p.py <sentences.txt> <out-dir> [g2pw-model-dir]
Runs g2pM and g2pW on CPP-format sentences (polyphone marked ▁X▁); writes cpp-g2pm.json and cpp-g2pw.json
(or <stem>-g2pm.json for another input). Both models were trained on CPP's training split."""
import json
import os
import sys
import time

src, out_dir = sys.argv[1], sys.argv[2]
stem = 'cpp' if os.path.basename(src) == 'test.sent' else os.path.splitext(os.path.basename(src))[0]
lines = [l for l in open(src, encoding='utf8').read().split('\n') if l]
positions = [l.index('▁') for l in lines]
texts = [l.replace('▁', '') for l in lines]


def save(name, predictions, ms):
    json.dump({'engine': name, 'ms': ms, 'predictions': predictions}, open(os.path.join(out_dir, f'{stem}-{name}.json'), 'w'))
    print(name, f'{ms:.0f} ms', flush=True)


from g2pM import G2pM  # noqa: E402

g2pm = G2pM()
t = time.perf_counter()
save('g2pm', [g2pm(s, tone=True, char_split=True)[p] for s, p in zip(texts, positions)], (time.perf_counter() - t) * 1000)

from g2pw import G2PWConverter  # noqa: E402

kw = {'model_dir': sys.argv[3]} if len(sys.argv) > 3 else {}
conv = G2PWConverter(style='pinyin', enable_non_tradional_chinese=True, num_workers=4, **kw)
t = time.perf_counter()
out = conv(texts)
save('g2pw', [o[p] for o, p in zip(out, positions)], (time.perf_counter() - t) * 1000)
