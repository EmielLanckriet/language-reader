"""Ways of cutting audio for SenseVoice: fixed 30 s, 30 s with 2 s overlap, and pause-based (Silero VAD).

    python cuts.py <model dir, with silero_vad.onnx> <16 kHz mono wav> [VAD threshold] > cuts.json

The measurement behind choosing 30 s with 2 s overlap and no VAD (docs/backlog.md).
"""
import sys, json, time, soundfile as sf, sherpa_onnx as so
M, wav = sys.argv[1], sys.argv[2]
rec = so.OfflineRecognizer.from_sense_voice(model=f'{M}/model.int8.onnx', tokens=f'{M}/tokens.txt', language='zh', use_itn=False, num_threads=4)
a, sr = sf.read(wav, dtype='float32'); dur = len(a) / sr

def decode(s, e):
    st = rec.create_stream(); st.accept_waveform(sr, a[int(s * sr):int(e * sr)]); rec.decode_stream(st)
    r = st.result
    return [(tok, s + t) for tok, t in zip(r.tokens, r.timestamps)]

def fixed(win, overlap):
    out, step, k = [], win - overlap, 0
    while k * step < dur:
        s, e = k * step, min(k * step + win, dur)
        lo = s + overlap / 2 if k else 0
        hi = e - overlap / 2 if e < dur else dur + 1
        out += [(tok, t) for tok, t in decode(s, e) if lo <= t < hi]
        k += 1
    return out, None

def vad_segments(min_silence):
    cfg = so.VadModelConfig(silero_vad=so.SileroVadModelConfig(model=f'{M}/silero_vad.onnx', threshold=float(sys.argv[3]) if len(sys.argv) > 3 else 0.5, min_silence_duration=min_silence, min_speech_duration=0.25, max_speech_duration=30), sample_rate=sr)
    vad = so.VoiceActivityDetector(cfg, buffer_size_in_seconds=dur + 10)
    segs = []
    for i in range(0, len(a), 512):
        vad.accept_waveform(a[i:i + 512])
        while not vad.empty(): segs.append((vad.front.start / sr, vad.front.start / sr + len(vad.front.samples) / sr)); vad.pop()
    vad.flush()
    while not vad.empty(): segs.append((vad.front.start / sr, vad.front.start / sr + len(vad.front.samples) / sr)); vad.pop()
    return segs

def by_pauses(merge, min_silence=0.5, pad=0.2):
    segs = vad_segments(min_silence)
    groups, cur = [], None
    for s, e in segs:
        if cur and e - cur[0] <= merge: cur[1] = e
        else:
            if cur: groups.append(cur)
            cur = [s, e]
    if cur: groups.append(cur)
    out = []
    for s, e in groups: out += decode(max(0, s - pad), min(dur, e + pad))
    speech = sum(e - s for s, e in segs)
    return out, {'segments': len(segs), 'groups': [round(e - s, 1) for s, e in groups], 'speech_s': round(speech, 1), 'skipped_s': round(dur - speech, 1)}

res = {}
for name, fn in [('A fixed 30', lambda: fixed(30, 0)), ('B 30 overlap 2', lambda: fixed(30, 2)), ('C pauses merge 15', lambda: by_pauses(15)), ('D pauses merge 30', lambda: by_pauses(30))]:
    t = time.time(); toks, info = fn()
    res[name] = {'seconds': round(time.time() - t, 1), 'tokens': toks, 'info': info}
print(json.dumps({'duration': dur, 'runs': res}, ensure_ascii=False))
