"""Build items.json: one sense-picking question per labelled word, frozen and self-contained.

Usage: python3 scripts/compare-senses/make-items.py
Reads the translator corpus and the segmenter harness's CC-CEDICT copy; writes items.json beside this file.
"""
import json
import os
import re
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
CORPUS = os.path.join(ROOT, 'scripts/compare-translators/corpus.json')
CEDICT = os.path.join(ROOT, 'scripts/compare-segmenters/data/cedict_1_0_ts_utf-8_mdbg.txt')

# (sentence id, word, acceptable sense indices, acceptable meta options, note). Indices count every CC-CEDICT
# sense of the simplified headword in file order; meta options are defined in question.mjs. Labelled by Claude for review.
LABELS = [
    ('tariff-joined-01', '判', [2, 3], [], 'the court ruled the tariff policy illegal'),
    ('tariff-joined-02', '那', [5], [], 'sentence-initial 那: then, in that case'),
    ('tariff-joined-02', '发起', [1, 2, 3], [], 'launched a trade war; "launch (an attack, an initiative)" fits best'),
    ('tariff-joined-02', '战', [2, 3], [], 'tariff war'),
    ('tariff-joined-02', '白', [3], [], '白整: done in vain'),
    ('tariff-joined-02', '整', [5], [], 'colloquial/dialect "to do" in 白整'),
    ('tariff-joined-03', '折腾', [1, 4], ['none'], 'a year of hard toil and fuss; no exact sense, nearest two accepted'),
    ('tariff-joined-03', '收', [2], [], 'tariffs collected'),
    ('tariff-joined-03', '得', [14, 15, 17], [], 'dei3: will they have to be refunded'),
    ('tariff-joined-04', '咱', [3], [], 'inclusive we, addressing viewers'),
    ('tariff-joined-04', '聊', [0], [], 'to chat about'),
    ('tariff-joined-04', '哈', [], ['none'], 'sentence-final softening particle; CC-CEDICT has no such sense'),
    ('tariff-joined-05', '大事', [0], [], 'a major event shaking global trade'),
    ('cooking-joined-01', '跟', [4, 6], [], 'share with everyone'),
    ('cooking-joined-01', '道', [6], [], 'classifier for a dish/course'),
    ('cooking-joined-02', '熟透', [0, 1], [], 'fully ripe tomatoes'),
    ('cooking-joined-03', '切', [0], [], 'to cut'),
    ('cooking-joined-03', '块', [0], [], 'chunks'),
    ('cooking-joined-04', '打入', [3], [], 'crack eggs into the bowl'),
    ('cooking-joined-04', '加入', [2, 4], [], 'add salt'),
    ('cooking-joined-05', '加', [2], [], 'add vinegar'),
    ('cooking-joined-06', '烧', [1], [], 'heat the wok'),
    ('cooking-joined-06', '滑', [2], ['none', 'segment'], '滑锅: coat the wok with oil; nearest is "slippery; smooth"'),
    ('cooking-joined-07', '将', [6], [], 'object marker like 把'),
    ('cooking-joined-07', '好', [6], [], '滑好锅: completion complement'),
    ('cooking-joined-07', '倒', [7, 8], [], 'pour the hot oil out'),
    ('cooking-joined-07', '底', [1], ['segment'], '底油: base oil left in the wok'),
    ('cooking-joined-08', '成', [10], [], '四成热: 40% hot, tenths'),
    ('cooking-joined-08', '打', [2], [], 'beat the eggs; the light-verb sense is nearest'),
    ('cooking-joined-08', '开', [2], [], 'turn on a low flame'),
    ('cooking-joined-08', '火', [1], [], 'flame, heat'),
    ('cooking-joined-08', '翻', [0, 1], [], 'flip the egg over'),
    ('cooking-joined-08', '香', [0, 2, 3], [], '炒香: fry until fragrant'),
    ('cooking-joined-08', '即可', [0, 3], [], 'and that is done'),
    # Added for the meta options: segmentation errors, dictionary gaps and compositional uses.
    ('cooking-joined-00', '刚', [], ['segment'], 'part of the name 王刚'),
    ('tariff-joined-01', '特', [], ['segment'], 'part of the name 特朗普'),
    ('cooking-joined-01', '加重', [], ['none', 'segment'], 'ASR error for 家常菜, home-style dish'),
    ('cooking-joined-03', '滚刀', [], ['none', 'segment', 'compositional'], '滚刀块: roll-cut chunks, not a gear hob'),
    ('cooking-joined-04', '白', [2], ['segment'], 'part of 白醋, white vinegar'),
    ('cooking-joined-02', '熟', [0], ['segment'], 'part of 熟透, fully ripe'),
    ('cooking-joined-01', '期', [6], ['segment'], 'part of 本期, this episode'),
    ('cooking-joined-08', '翻过', [0], ['compositional'], '翻过来: flip over, 翻 plus directional 过'),
]


def senses():
    d = defaultdict(list)
    for line in open(CEDICT, encoding='utf8'):
        m = re.match(r'(\S+) (\S+) \[([^\]]+)\] /(.*)/$', line.rstrip('\n'))
        if m:
            d[m.group(2)].extend(f'{m.group(3)}: {s}' for s in m.group(4).split('/'))
    return d


def main():
    d = senses()
    texts = {r['id']: r['text'] for r in json.load(open(CORPUS, encoding='utf8'))}
    items = []
    for n, (sid, word, gold, meta, note) in enumerate(LABELS):
        text = texts[sid]
        items.append({
            'id': f'{n:02d}-{word}', 'source': sid, 'sentence': text, 'word': word, 'start': text.index(word),
            'senses': d[word], 'gold': gold, 'goldMeta': meta, 'note': note,
        })
    json.dump(items, open(os.path.join(HERE, 'items.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print(len(items), 'items; senses per item:', sorted(len(i['senses']) for i in items))


main()
