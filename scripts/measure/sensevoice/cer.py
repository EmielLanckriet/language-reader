"""Issue #30: transcripts at several window lengths against a human subtitle track.

    python cer.py <name> <human.vtt> <offset s> <dir with W30.json W20.json W15.json W10.json>

Each W<n>.json is app-tokens.mjs over the same 600 s excerpt starting at <offset>, with windows of
<n> s. Speaker names ("光头强：") and everything but Han characters are left out of both sides.
"""
import json, re, sys
def ref_text(vtt, off, dur):
    v = open(vtt).read()
    out = []
    for m in re.finditer(r'(\d+):(\d+):(\d+)\.(\d+) --> [^\n]*\n((?:[^\n]+\n?)+)', v):
        s = int(m[1])*3600 + int(m[2])*60 + int(m[3]) + int(m[4])/1000
        if off <= s < off + dur:
            text = re.sub(r'^[^：:\n]{1,8}[：:]', '', m[5].strip(), flags=re.M)
            out.append(text)
    return clean(''.join(out))
def clean(s): return ''.join(ch for ch in s if '一' <= ch <= '鿿')
def align(r, h):
    n, m = len(r), len(h)
    prev = list(range(m + 1)); bt = [bytearray(m + 1) for _ in range(n + 1)]
    for j in range(1, m + 1): bt[0][j] = 3
    for i in range(1, n + 1):
        cur = [i] + [0] * m; bt[i][0] = 2
        for j in range(1, m + 1):
            sub = prev[j-1] + (r[i-1] != h[j-1]); dele = prev[j] + 1; ins = cur[j-1] + 1
            best = min(sub, dele, ins); cur[j] = best
            bt[i][j] = 1 if best == sub else (2 if best == dele else 3)
        prev = cur
    i, j, H = n, m, 0; S = D = I = 0
    while i or j:
        k = bt[i][j]
        if k == 1: H += r[i-1] == h[j-1]; S += r[i-1] != h[j-1]; i -= 1; j -= 1
        elif k == 2: D += 1; i -= 1
        else: I += 1; j -= 1
    return H, S, D, I
name, vtt, off = sys.argv[1], sys.argv[2], float(sys.argv[3])
ref = ref_text(vtt, off, 600)
print(f"{name}: reference {len(ref)} characters")
for w in (30, 20, 15, 10):
    t = json.load(open(f"{sys.argv[4]}/W{w}.json"))['tokens']
    hyp = clean(''.join(x for x, _ in t))
    H, S, D, I = align(ref, hyp)
    print(f"  {w:2d} s windows: found {len(hyp):4d} | correct {H:4d} ({H/len(ref):5.1%}) missed {D:4d} wrong {S:3d} inserted {I:3d} | CER {(S+D+I)/len(ref):5.1%}")
