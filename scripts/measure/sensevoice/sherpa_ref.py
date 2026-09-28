"""SenseVoice through sherpa-onnx in fixed windows: the reference check.mjs compares against.

    python sherpa_ref.py <model dir> <16 kHz mono wav> [window seconds, 0 = whole] > ref.json

Number normalisation (ITN) is off: with it on, numbers came out as 20到4000 for 两千到四千.
"""
import json, sys, time
import sherpa_onnx as so
import soundfile as sf

M, wav = sys.argv[1], sys.argv[2]
win = float(sys.argv[3]) if len(sys.argv) > 3 else 30
rec = so.OfflineRecognizer.from_sense_voice(model=f'{M}/model.int8.onnx', tokens=f'{M}/tokens.txt',
                                            language='zh', use_itn=False, num_threads=4)
a, sr = sf.read(wav, dtype='float32')
step = int(win * sr) if win else len(a)
out, t0 = [], time.time()
for i in range(0, len(a), step):
    s = rec.create_stream(); s.accept_waveform(sr, a[i:i + step]); rec.decode_stream(s)
    out.append({'start': i / sr, 'text': s.result.text, 'tokens': list(s.result.tokens),
                'ts': [i / sr + t for t in s.result.timestamps]})
print(json.dumps({'seconds': round(time.time() - t0, 2), 'audio': len(a) / sr, 'chunks': out}, ensure_ascii=False))
