"""Score forced-choice runs on one video's in-scope words against a gold file (issue #16).

Usage: python3 -I scripts/compare-senses/score-video.py <items.json> <gold.json> <run.json>...
gold.json: {"forced": {item id: [[acceptable sense indices], note]}}. Runs come from run-qwen.mjs (first round).

Baselines: the first CC-CEDICT sense in file order; the first sense the word sheet shows (gloss.ts ranked(), entry
tiers only, without the in-context reading); chance (1 / number of senses, summed). An item is "non-trivial" when its
gold set leaves out at least one sense that is not a surname, variant, cross-reference or classifier line.
"""
import json
import re
import statistics
import sys
from collections import defaultdict

RARE = re.compile(r'^(surname|variant of|old variant|used in|see |archaic|Japanese variant)|\((archaic|classical|literary|old)\)', re.I)
# Must match question.mjs's NOT_A_MEANING: a --trim run's pick indexes the kept senses only.
TRIM = re.compile(r'^[^:]+: (surname |(old )?variant of |see |used in |Taiwan pr\.|also pr\.|CL:|abbr\. for |Kangxi radical)')
NOT_A_MEANING = re.compile(r'^(surname |(old )?variant of |see |used in |Taiwan pr\.|also pr\.|CL:|abbr\. for |Kangxi radical|sometimes written )')


def entries(item):
    out = []
    for i, s in enumerate(item['senses']):
        p, sense = s.split(': ', 1)
        if out and out[-1]['pinyin'] == p and i == out[-1]['end']:
            out[-1]['end'] = i + 1
            out[-1]['senses'].append(sense)
        else:
            out.append({'pinyin': p, 'start': i, 'end': i + 1, 'senses': [sense]})
    return out


def app_first(item):
    def tier(e):
        if all(RARE.match(s) for s in e['senses']):
            return 2
        return 1 if e['senses'][0].startswith('(bound form)') or e['pinyin'][:1].isupper() else 0
    return sorted(entries(item), key=lambda e: (tier(e) == 2, tier(e), e['start']))[0]['start']


def main():
    items = {i['id']: i for i in json.load(open(sys.argv[1], encoding='utf8'))}
    gold = json.load(open(sys.argv[2], encoding='utf8'))['forced']
    runs = [json.load(open(p, encoding='utf8')) for p in sys.argv[3:]]
    picks = []
    for run in runs:
        pk = {}
        for r in run['variants']['forced']['rounds'][0]:
            senses = items[r['id']]['senses']
            kept = [j for j, x in enumerate(senses) if not (run.get('trim') and TRIM.match(x))]
            pk[r['id']] = {**r, 'pick': kept[r['pick']],
                           'probabilities': [r['probabilities'][kept.index(j)] if j in kept else 0 for j in range(len(senses))]}
        # Trimming can leave one sense; the run then skips the word, and that sense is what would be shown.
        for k, it in items.items():
            kept = [j for j, x in enumerate(it['senses']) if not (run.get('trim') and TRIM.match(x))]
            if k not in pk and len(it['senses']) > 1 and len(kept) == 1:
                pk[k] = {'id': k, 'pick': kept[0], 'probabilities': [float(j == kept[0]) for j in range(len(it['senses']))],
                         'ms': 0, 'inputTokens': 0, 'letterMass': 1}
        picks.append(pk)
    ids = sorted(gold)
    nontrivial = [k for k in ids if any(j not in gold[k][0] and not NOT_A_MEANING.match(s.split(': ', 1)[1])
                                         for j, s in enumerate(items[k]['senses']))]
    print(f'labelled items: {len(ids)}, non-trivial: {len(nontrivial)}')
    for name, subset in (('all', ids), ('non-trivial', nontrivial)):
        print(f'\n[{name}, n={len(subset)}]')
        print(f'  first listed sense : {sum(0 in gold[k][0] for k in subset)}')
        print(f'  first shown by app : {sum(app_first(items[k]) in gold[k][0] for k in subset)}')
        print(f'  chance             : {sum(len(gold[k][0]) / len(items[k]["senses"]) for k in subset):.1f}')
        for run, pk in zip(runs, picks):
            c = sum(pk[k]['pick'] in gold[k][0] for k in subset)
            print(f'  {run["engine"] + (" trim" if run.get("trim") else ""):<19}: {c}  ({100 * c / len(subset):.0f}%)')
    for run, pk in zip(runs, picks):
        rows = [r for r in pk.values() if r['inputTokens']]
        ms = sorted(r['ms'] for r in rows)
        right = [pk[k]['probabilities'][pk[k]['pick']] for k in ids if pk[k]['pick'] in gold[k][0]]
        wrong = [pk[k]['probabilities'][pk[k]['pick']] for k in ids if pk[k]['pick'] not in gold[k][0]]
        print(f'\n{run["engine"]}: {len(rows)} words run, median {statistics.median(ms):.0f} ms, p95 {ms[int(0.95 * (len(ms) - 1))]:.0f} ms, '
              f'load {run["loadMs"]:.0f} ms, peak RSS {run["peakRssBytes"] / 2**20:.0f} MiB, median prompt tokens '
              f'{statistics.median(r["inputTokens"] for r in rows):.0f}, min letter mass {min(r["letterMass"] for r in rows):.3f}; '
              f'mean top p right {statistics.mean(right):.2f} / wrong {statistics.mean(wrong) if wrong else float("nan"):.2f}')
    if len(runs) == 2:
        common = sorted(set(picks[0]) & set(picks[1]))
        agree = sum(picks[0][k]['pick'] == picks[1][k]['pick'] for k in common)
        print(f'\nagreement on the whole scope: {agree} / {len(common)} words ({100 * agree / len(common):.0f}%)')
        # Agreement in meaning: the other model's pick is in a gold set, when labelled.
    print('\nper item (gold | picks):')
    for k in ids:
        it = items[k]
        cells = []
        for pk in picks:
            p = pk[k]['pick']
            cells.append(f'{"ok " if p in gold[k][0] else "XX "}{p}:{it["senses"][p][:38]}')
        print(f'  {k:<12} gold {gold[k][0]} | ' + ' | '.join(cells))


main()
