"""Issue #14: character error rate against human subtitles for one pass, a second shifted pass, their
combination, and any extra transcripts (e.g. Qwen3-ASR).

    python score.py <ref.vtt> <excerpts list: name start seconds> <results dir>

Reads <dir>/passes-<name>.json (passes.mjs) and, if present, <dir>/qwen-<name>.json ({"text": ...}).
Only Han characters count, on both sides, so punctuation, speaker names ("熊大：") and Latin words
are left out. Subtitle cues count when they lie wholly inside the excerpt; excerpts are cut in
gaps between cues (excerpts.py). With FILLERS=1 in the environment, common interjections
(啊 哈 嘿 嗯 …) are dropped from both sides too.

Combining A (app windows) and B (shifted windows): align the two character sequences, and in each
stretch where they disagree keep one side whole:
  score    — the side whose characters have the higher mean CTC posterior; against an empty side,
             the non-empty side is kept when that mean is at least 0.5
  position — the side whose characters lie further from their window's edge
  oracle   — whichever side lowers the error against the subtitles, stretch by stretch (a bound
             on what any rule choosing between A and B can gain)
"""
import json, os, re, sys


def cues(vtt):
    out = []
    for m in re.finditer(r'(\d+):(\d+):(\d+)\.(\d+) --> (\d+):(\d+):(\d+)\.(\d+)[^\n]*\n((?:[^\n]+\n?)+)', open(vtt).read()):
        g = [int(x) for x in m.groups()[:8]]
        s = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        e = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        out.append((s, e, re.sub(r'^[^：:\n]{1,8}[：:]', '', m[9].strip(), flags=re.M)))
    return out


# FILLERS=1 also drops interjections, which subtitles often leave out and some models write.
FILLERS = set('啊呀哈嘿嗯呃哦噢诶欸哎喂哼嗷呜呦哟唉嘛呢吧') if os.environ.get('FILLERS') == '1' else set()


def han(s):
    return ''.join(ch for ch in s if '一' <= ch <= '鿿' and ch not in FILLERS)


def ops(r, h):
    """Levenshtein alignment of r against h: list of (op, i, j), op in = S D I."""
    n, m = len(r), len(h)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        d[i][0] = i
    for j in range(m + 1):
        d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i - 1][j - 1] + (r[i - 1] != h[j - 1]), d[i - 1][j] + 1, d[i][j - 1] + 1)
    i, j, out = n, m, []
    while i or j:
        if i and j and d[i][j] == d[i - 1][j - 1] + (r[i - 1] != h[j - 1]):
            out.append(('=' if r[i - 1] == h[j - 1] else 'S', i - 1, j - 1)); i -= 1; j -= 1
        elif i and d[i][j] == d[i - 1][j] + 1:
            out.append(('D', i - 1, None)); i -= 1
        else:
            out.append(('I', None, j - 1)); j -= 1
    return out[::-1]


def errors(ref, hyp):
    o = ops(ref, hyp)
    return sum(op != '=' for op, _, _ in o), sum(op == 'D' for op, _, _ in o), sum(op == 'S' for op, _, _ in o), sum(op == 'I' for op, _, _ in o)


def chars(tokens):
    """Han characters of a pass with (posterior, distance from window edge) each."""
    out = []
    for text, _t, p, _margin, edge in tokens:
        for ch in han(text):
            out.append((ch, p, edge))
    return out


def regions(a, b):
    """Alternating agreement and disagreement stretches: list of (agree, a slice, b slice)."""
    o = ops([c for c, _, _ in a], [c for c, _, _ in b])
    out, cur, ai, bi = [], None, 0, 0
    for op, i, j in o:
        same = op == '='
        if cur is None or cur[0] != same:
            cur = [same, [], []]
            out.append(cur)
        if i is not None:
            cur[1].append(a[i])
        if j is not None:
            cur[2].append(b[j])
    return out


def choose(region, rule):
    _, sa, sb = region
    mean = lambda s, k: sum(c[k] for c in s) / len(s)
    if rule == 'score':
        if not sa or not sb:
            side = sa or sb
            keep = mean(side, 1) >= 0.5
            return (sa if keep else sb) if sa else (sb if keep else sa)
        return sa if mean(sa, 1) >= mean(sb, 1) else sb
    if rule == 'position':
        if not sa or not sb:
            # Nothing on one side: keep what the other found when it lies further from an edge.
            side = sa or sb
            return side if mean(side, 2) >= 1.0 else []
        return sa if mean(sa, 2) >= mean(sb, 2) else sb
    raise ValueError(rule)


def text(regs, picks):
    return ''.join(c for r, p in zip(regs, picks) for c, _, _ in (r[1] if r[0] else p))


vtt, listing, folder = sys.argv[1:4]
all_cues = cues(vtt)
totals = {}
rows = []
for line in open(listing):
    name, start, length = line.split()
    s, e = float(start), float(start) + float(length)
    ref = han(''.join(c for a, b, c in all_cues if a >= s and b <= e))
    d = json.load(open(f'{folder}/passes-{name}.json'))
    a, b = chars(d['passes']['A']['tokens']), chars(d['passes']['B']['tokens'])
    regs = regions(a, b)
    hyps = {'A (app windows)': ''.join(c for c, _, _ in a), f'B (shifted {d["shift"]:g} s)': ''.join(c for c, _, _ in b)}
    for rule in ('score', 'position'):
        hyps[f'A+B by {rule}'] = text(regs, [None if r[0] else choose(r, rule) for r in regs])
    # Greedy oracle: start from A, swap each disagreement to B when that lowers the error.
    picks = [None if r[0] else r[1] for r in regs]
    best = errors(ref, text(regs, picks))[0]
    for k, r in enumerate(regs):
        if r[0]:
            continue
        picks[k] = r[2]
        e2 = errors(ref, text(regs, picks))[0]
        if e2 < best:
            best = e2
        else:
            picks[k] = r[1]
    hyps['A+B oracle'] = text(regs, picks)
    q = f'{folder}/qwen-{name}.json'
    if os.path.exists(q):
        for key, val in json.load(open(q)).items():
            if key.startswith('text'):
                hyps[f'Qwen3-ASR {key[5:] or ""}'.strip()] = han(val)
    disagree = sum(1 for r in regs if not r[0])
    print(f'{name}: {s:.1f}-{e:.1f} s, reference {len(ref)} characters, {disagree} stretches where A and B disagree')
    for k, h in hyps.items():
        err, dl, sub, ins = errors(ref, h)
        t = totals.setdefault(k, [0, 0, 0, 0, 0])
        for i, v in enumerate((err, dl, sub, ins, len(ref))):
            t[i] += v
        print(f'  {k:24s} CER {err / len(ref):6.1%}  (missed {dl:3d}, wrong {sub:3d}, inserted {ins:3d})')
print('all excerpts:')
for k, (err, dl, sub, ins, n) in totals.items():
    print(f'  {k:24s} CER {err / n:6.1%}  (missed {dl:3d}, wrong {sub:3d}, inserted {ins:3d}) of {n}')
