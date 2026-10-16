"""List the words of one library document that the reader's scope for sense picking covers (issue #16).

Usage: python3 -I scripts/compare-senses/video-scope.py <backup.json> <tokens.json> <document id> <out.json>

tokens.json comes from bert-segment.mjs (the shipped BERT tagger plus the reader's corrections). Output holds the
reader's learning state, so write it outside the repository.

Scope (the reader, 2026-09-28): words new or hard at import, plus every word missing from CC-CEDICT, once per word
per document. Definitions used here, all evaluated at the document's import time T0:
  new     no mark, no lookup/check/review/Anki example, and never inside a played range of another document
  hard    looked up at least once, or graded Again (1) in a review
  missing no CC-CEDICT headword equal to the word
"""
import json
import os
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CEDICT = os.path.join(ROOT, 'scripts/compare-segmenters/data/cedict_1_0_ts_utf-8_mdbg.txt')


def senses():
    d = defaultdict(list)
    for line in open(CEDICT, encoding='utf8'):
        m = re.match(r'(\S+) (\S+) \[([^\]]+)\] /(.*)/$', line.rstrip('\n'))
        if m:
            d[m.group(2)].extend(f'{m.group(3)}: {s}' for s in m.group(4).split('/'))
    return d


def main():
    backup_path, tokens_path, doc_id, out_path = sys.argv[1:5]
    b = json.load(open(backup_path, encoding='utf8'))
    tokens = json.load(open(tokens_path, encoding='utf8'))
    docs = {d['id']: d for d in b['documents']}
    doc = docs[int(doc_id)]
    t0 = doc['createdAt']
    text = doc['rawContent']

    marked, touched, hard = set(), set(), set()
    for e in b['events']:
        if e['assertedAt'] < t0:
            marked.add(e['surface'])
    played = defaultdict(list)
    for e in b['encounters']:
        if e.get('at', '9') >= t0:
            continue
        if e['kind'] == 'played' and e.get('documentId') in docs and e.get('documentId') != doc['id']:
            played[e['documentId']].append((e['from'], e['to']))
        s = e.get('surface')
        if not s:
            continue
        if e['kind'] in ('lookup', 'check', 'review', 'anki-example', 'tap-undone'):
            touched.add(s)
        if e['kind'] == 'lookup' or (e['kind'] == 'review' and e.get('detail', {}).get('grade') == 1):
            hard.add(s)
    heard = set()
    for did, ranges in played.items():
        dtext = docs[did]['rawContent']
        for s, e, w in tokens[str(did)]:
            if w and any(s < to and e > fr for fr, to in ranges):
                heard.add(dtext[s:e])

    d = senses()
    lines = text.split('\n')
    line_start = []
    at = 0
    for ln in lines:
        line_start.append(at)
        at += len(ln) + 1
    seen = set()
    items = []
    counts = defaultdict(int)
    for s, e, w in tokens[str(doc['id'])]:
        if not w:
            continue
        word = text[s:e]
        counts['word tokens'] += 1
        if word in seen:
            continue
        seen.add(word)
        counts['distinct words'] += 1
        is_new = word not in marked and word not in touched and word not in heard
        is_hard = word in hard
        missing = word not in d
        if not (is_new or is_hard or missing):
            continue
        li = max(i for i, st in enumerate(line_start) if st <= s)
        # Context: the subtitle line plus its neighbours, as the translation pass sees a line in context.
        lo, hi = max(0, li - 1), min(len(lines), li + 2)
        sentence = ' '.join(lines[lo:hi])
        start = sum(len(x) + 1 for x in lines[lo:li]) + (s - line_start[li])
        assert sentence[start:start + len(word)] == word
        items.append({
            'id': f'{len(items):03d}-{word}', 'source': f'doc{doc["id"]}-line{li}', 'sentence': sentence,
            'word': word, 'start': start, 'offset': s, 'senses': d.get(word, []),
            'new': is_new, 'hard': is_hard, 'missing': missing,
        })
    counts['in scope'] = len(items)
    counts['new'] = sum(i['new'] for i in items)
    counts['hard'] = sum(i['hard'] for i in items)
    counts['missing'] = sum(i['missing'] for i in items)
    counts['in CC-CEDICT, one sense'] = sum(len(i['senses']) == 1 for i in items)
    counts['in CC-CEDICT, 2+ senses'] = sum(len(i['senses']) > 1 for i in items)
    json.dump({'document': doc['id'], 'title': doc['title'], 't0': t0, 'counts': counts, 'items': items},
              open(out_path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(json.dumps(counts, ensure_ascii=False))


main()
