"""Chinese text-to-speech candidates for spoken stories (issue #10's follow-up), laptop only.

    python compare.py <models dir> <sensevoice dir> <text file> <out dir> [threads]

Speaks the text one sentence at a time with each candidate (sherpa-onnx), timing generation, and
writes one wav per candidate plus its cue times. Clarity is checked by transcribing each sentence
back with SenseVoice and scoring Han characters against the text: a proxy for mispronounced or
garbled words, not for how natural the voice sounds, which only listening can tell.
"""
import json
import os
import re
import sys
import time
import wave

import numpy as np
import sherpa_onnx

models, sv, text_file, out = sys.argv[1:5]
threads = int(sys.argv[5]) if len(sys.argv) > 5 else 4
os.makedirs(out, exist_ok=True)
text = open(text_file, encoding='utf-8').read()
sentences = [s for s in re.findall(r'[^。！？!?\n]+[。！？!?”]*', text) if re.search(r'[一-鿿]', s)]


def han(s):
    return ''.join(re.findall(r'[一-鿿]', s))


def edit_distance(a, b):
    row = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        prev, row[0] = row[0], i
        for j, cb in enumerate(b, 1):
            prev, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, prev + (ca != cb))
    return row[-1]


def rules(d):
    return ','.join(f'{d}/{f}' for f in ('phone.fst', 'date.fst', 'number.fst') if os.path.exists(f'{d}/{f}'))


def candidates():
    d = f'{models}/matcha-icefall-zh-baker.x/matcha-icefall-zh-baker'
    yield 'matcha-baker', sherpa_onnx.OfflineTtsModelConfig(matcha=sherpa_onnx.OfflineTtsMatchaModelConfig(
        acoustic_model=f'{d}/model-steps-3.onnx', vocoder=f'{models}/vocos-22khz-univ.onnx',
        lexicon=f'{d}/lexicon.txt', tokens=f'{d}/tokens.txt', dict_dir=f'{d}/dict'),
        num_threads=threads), rules(d), 0
    d = f'{models}/vits-melo-tts-zh_en.x/vits-melo-tts-zh_en'
    yield 'melo-zh-en', sherpa_onnx.OfflineTtsModelConfig(vits=sherpa_onnx.OfflineTtsVitsModelConfig(
        model=f'{d}/model.onnx', lexicon=f'{d}/lexicon.txt', tokens=f'{d}/tokens.txt',
        dict_dir=f'{d}/dict'), num_threads=threads), rules(d), 0
    d = f'{models}/kokoro-multi-lang-v1_1.x/kokoro-multi-lang-v1_1'
    for sid in (3, 60):
        yield f'kokoro-{sid}', sherpa_onnx.OfflineTtsModelConfig(kokoro=sherpa_onnx.OfflineTtsKokoroModelConfig(
            model=f'{d}/model.onnx', voices=f'{d}/voices.bin', tokens=f'{d}/tokens.txt',
            lexicon=f'{d}/lexicon-us-en.txt,{d}/lexicon-zh.txt', data_dir=f'{d}/espeak-ng-data',
            dict_dir=f'{d}/dict'), num_threads=threads), rules(d), sid


recognizer = sherpa_onnx.OfflineRecognizer.from_sense_voice(
    model=f'{sv}/model.int8.onnx', tokens=f'{sv}/tokens.txt', language='zh', use_itn=False, num_threads=threads)
report = {}
for name, model, fsts, sid in candidates():
    t0 = time.perf_counter()
    tts = sherpa_onnx.OfflineTts(sherpa_onnx.OfflineTtsConfig(model=model, rule_fsts=fsts, max_num_sentences=1))
    load = time.perf_counter() - t0
    pieces, cues, at, gen, errors, total = [], [], 0.0, 0.0, 0, 0
    for sentence in sentences:
        t = time.perf_counter()
        audio = tts.generate(sentence, sid=sid, speed=1.0)
        gen += time.perf_counter() - t
        samples = np.array(audio.samples, dtype=np.float32)
        rate = audio.sample_rate
        cues.append({'start': at, 'end': at + len(samples) / rate, 'text': sentence})
        at += len(samples) / rate + 0.35
        pieces += [samples, np.zeros(int(0.35 * rate), dtype=np.float32)]
        stream = recognizer.create_stream()
        stream.accept_waveform(rate, samples)
        recognizer.decode_stream(stream)
        heard = han(stream.result.text)
        errors += edit_distance(han(sentence), heard)
        total += len(han(sentence))
    pcm = (np.clip(np.concatenate(pieces), -1, 1) * 32767).astype('<i2')
    with wave.open(f'{out}/{name}.wav', 'wb') as w:
        w.setnchannels(1), w.setsampwidth(2), w.setframerate(rate), w.writeframes(pcm.tobytes())
    report[name] = {'loadSeconds': round(load, 1), 'generateSeconds': round(gen, 1), 'audioSeconds': round(at, 1),
                    'realTimeFactor': round(gen / at, 3), 'cer': round(errors / total, 3), 'sampleRate': rate}
    json.dump(cues, open(f'{out}/{name}.cues.json', 'w'), ensure_ascii=False)
    print(name, report[name], flush=True)
json.dump(report, open(f'{out}/report.json', 'w'), indent=1)
