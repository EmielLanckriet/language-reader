"""Usage: python3 scripts/compare-pinyin/score.py
Scores results/<stem>-<engine>.json against $LABEL_DIR/<stem>.lb and everyday.tsv; writes results/summary.json."""
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LABEL_DIR = os.environ.get('LABEL_DIR', '')  # holds <stem>.lb files, e.g. cpp.lb (CPP test.lb) and cpp1k.lb


def norm(p):
    p = (p or '').strip().lower().replace('ü', 'v').replace('u:', 'v')
    return re.sub(r'0$', '5', p if re.search(r'\d$', p) else p + '5')


gold = {'everyday': [l.split('\t')[1] for l in open(os.path.join(HERE, 'everyday.tsv'), encoding='utf8').read().split('\n') if l]}
for lb in glob.glob(os.path.join(LABEL_DIR, '*.lb')) if LABEL_DIR else []:
    gold[os.path.basename(lb)[:-3]] = [l for l in open(lb).read().split('\n') if l]
summary = {}
for path in sorted(glob.glob(os.path.join(HERE, 'results', '*-*.json'))):
    stem, engine = os.path.basename(path)[:-5].split('-', 1)
    if stem not in gold:
        continue
    d = json.load(open(path))
    pred = [norm(p) for p in d['predictions']]
    g = [norm(x) for x in gold[stem]]
    right = sum(a == b for a, b in zip(pred, g))
    summary.setdefault(stem, {})[engine] = {'correct': right, 'of': len(g), 'accuracy': right / len(g), 'ms': d['ms'],
                                           'wrong': [i for i, (a, b) in enumerate(zip(pred, g)) if a != b][:40] if stem == 'everyday' else None}
    print(f'{stem:9} {engine:11} {right}/{len(g)} = {right / len(g):.2%}  {d["ms"]:.0f} ms')
json.dump(summary, open(os.path.join(HERE, 'results', 'summary.json'), 'w'), indent=1)
