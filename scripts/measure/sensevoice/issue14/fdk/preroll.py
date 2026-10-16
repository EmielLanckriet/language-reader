"""Issue #14: does a pre-roll of N AAC frames make FDK-AAC's output at a resume point equal to a
decode from frame 0? Prints, per resume time and N, the differing int16 samples in the 30 s after
the resume point and where the last one is.

    python preroll.py <fdkrange binary> <file.adts> [limiter -1|0|1]
"""
import subprocess, sys, time
import numpy as np

exe, adts = sys.argv[1], sys.argv[2]
limiter = sys.argv[3] if len(sys.argv) > 3 else '-1'
SPAN = 1300  # frames compared after the resume point, ~30 s at 44.1 kHz


def decode(start, keep, end):
    out = subprocess.run([exe, adts, str(start), str(keep), str(end), limiter], capture_output=True, check=True).stdout
    return np.frombuffer(out, dtype=np.int16).reshape(-1, 2)


for seconds in (120, 1800, 3600, 5400):
    k = round(seconds * 44100 / 1024)
    t = time.perf_counter()
    ref = decode(0, k, k + SPAN)
    ref_s = time.perf_counter() - t
    print(f'resume at {seconds} s (frame {k}); from-zero decode {ref_s:.2f} s')
    for n in (2, 8, 32, 128, 512, 2048, 8192):
        if n > k:
            continue
        got = decode(k - n, k, k + SPAN)
        d = np.any(got != ref, axis=1)
        idx = np.flatnonzero(d)
        last = f'last at +{idx[-1] / 44100:.2f} s, first +{idx[0] / 44100:.3f} s, max {np.abs(got.astype(int) - ref).max()}' if len(idx) else ''
        print(f'  preroll {n:5d}: {len(idx):7d} / {len(d)} sample frames differ {last}')
