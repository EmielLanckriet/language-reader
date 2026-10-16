"""Pick non-overlapping excerpts of a film whose human subtitles are densest, cut in gaps of at
least GAP seconds between cues so no line is split.   python excerpts.py <ref.vtt> [n] [seconds]"""
import re, sys
GAP = 1.0
vtt, n, length = sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 3, float(sys.argv[3]) if len(sys.argv) > 3 else 180


def t(h, m, s, ms):
    return int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000


cues = []
for m in re.finditer(r'(\d+):(\d+):(\d+)\.(\d+) --> (\d+):(\d+):(\d+)\.(\d+)[^\n]*\n((?:[^\n]+\n?)+)', open(vtt).read()):
    text = re.sub(r'^[^：:\n]{1,8}[：:]', '', m[9].strip(), flags=re.M)
    cues.append((t(*m.groups()[:4]), t(*m.groups()[4:8]), sum('一' <= c <= '鿿' for c in text)))
# Candidate cut points: the middle of every gap of at least GAP seconds.
cuts = [(a[1] + b[0]) / 2 for a, b in zip(cues, cues[1:]) if b[0] - a[1] >= GAP]
best = []
for s in cuts:
    ends = [e for e in cuts if length - 30 <= e - s <= length]
    if not ends:
        continue
    e = max(ends)
    chars = sum(c for a, b, c in cues if s <= a and b <= e)
    best.append((chars / (e - s), s, e, chars))
best.sort(reverse=True)
chosen = []
for d, s, e, c in best:
    if all(e <= cs - 60 or s >= ce + 60 for _, cs, ce, _ in chosen):
        chosen.append((d, s, e, c))
    if len(chosen) == n:
        break
for d, s, e, c in sorted(chosen, key=lambda x: x[1]):
    print(f'{s:.2f} {e - s:.2f} {c} {d:.2f}')
