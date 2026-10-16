"""Issue #14: Qwen3-ASR-0.6B (int8, sherpa-onnx 1.13.8) over a 16 kHz mono WAV, in chunks.

    python qwen.py <model dir> <audio.wav> <out.json> [chunk seconds] [threads]

The model gives text without timestamps, so overlapping windows cannot be joined by time as
SenseVoice's are. Chunks are cut without overlap, each cut moved to the quietest 100 ms within
±2 s of the nominal boundary (no reference used). Writes {"text": ..., "chunks": [...], timing}.
Run it under flock: the model is ~1 GB.
"""
import json, resource, sys, time
import numpy as np, soundfile as sf, sherpa_onnx

model, wav, out = sys.argv[1:4]
chunk = float(sys.argv[4]) if len(sys.argv) > 4 else 30
threads = int(sys.argv[5]) if len(sys.argv) > 5 else 4
t0 = time.perf_counter()
rec = sherpa_onnx.OfflineRecognizer.from_qwen3_asr(
    conv_frontend=f'{model}/conv_frontend.onnx', encoder=f'{model}/encoder.int8.onnx',
    decoder=f'{model}/decoder.int8.onnx', tokenizer=f'{model}/tokenizer', num_threads=threads,
    max_total_len=1024, max_new_tokens=256)
load = time.perf_counter() - t0
audio, rate = sf.read(wav, dtype='float32')
assert rate == 16000
hop = 1600
energy = np.array([np.mean(audio[i:i + hop] ** 2) for i in range(0, len(audio), hop)])
cuts, at = [0], chunk
while at < len(audio) / rate - 2:
    lo, hi = int((at - 2) * 10), int((at + 2) * 10)
    cuts.append((lo + int(np.argmin(energy[lo:hi]))) / 10)
    at = cuts[-1] + chunk
cuts.append(len(audio) / rate)
chunks, t0 = [], time.perf_counter()
for a, b in zip(cuts, cuts[1:]):
    s = rec.create_stream()
    s.accept_waveform(rate, audio[int(a * rate):int(b * rate)])
    t = time.perf_counter()
    rec.decode_stream(s)
    chunks.append({'from': a, 'to': b, 'seconds': time.perf_counter() - t, 'text': s.result.text})
decode = time.perf_counter() - t0
json.dump({'text': ''.join(c['text'] for c in chunks), 'chunks': chunks, 'loadSeconds': load,
           'decodeSeconds': decode, 'audioSeconds': len(audio) / rate, 'threads': threads,
           'chunkSeconds': chunk, 'maxRssMB': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024},
          open(out, 'w'), ensure_ascii=False, indent=1)
print(f'{wav}: load {load:.1f} s, decode {decode:.1f} s for {len(audio) / rate:.1f} s, peak RSS {resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024:.0f} MB')
