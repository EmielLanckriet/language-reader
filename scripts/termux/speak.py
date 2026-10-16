#!/usr/bin/env python3
"""A story spoken on the phone, packed as a download (spec 018, contracts/speak.md).

    speak.py <job folder> < request.json      # {"title": "...", "lines": ["一句。", ...]}

The reader service starts this for POST /speak. MeloTTS speaks each line through ~/opt/tts/speak
(sherpa-onnx, scripts/termux/tts/build-tts.sh); ffmpeg encodes the result to AAC; the line times
become media.zh.vtt; and bundle.tar appears in the job folder like any download, so Reader imports
it from New from Termux and plays it like a video. progress.json says how far it is meanwhile.
English then comes from translate.py, as for a download.

The speaker takes the model lock translate.py uses, so it never runs beside a translation or story,
and waits while Reader transcribes; it needs about 400 MB, not the 2 GB a language model does.
SPEAK_STUB=1 speaks a short tone per line instead of the model, for tests.
"""
import fcntl
import json
import math
import os
import re
import struct
import subprocess
import sys
import tarfile
import time
import wave

HERE = os.path.dirname(os.path.abspath(__file__))
SPEAKER = os.environ.get('READER_SPEAKER', os.path.expanduser('~/opt/tts/speak'))
VOICE = os.environ.get('READER_VOICE', os.path.expanduser('~/opt/tts/melo'))
FFMPEG = os.environ.get('READER_FFMPEG', 'ffmpeg')
MODEL_LOCK = os.environ.get('READER_MODEL_LOCK', os.path.expanduser('~/.reader/translation-model.lock'))
BUSY = os.environ.get('READER_BUSY', os.path.expanduser('~/.reader/busy'))
TRANSLATE = os.path.join(HERE, 'translate.py')


def progress(job, **state):
    with open(os.path.join(job, 'progress.json.part'), 'w', encoding='utf-8') as file:
        json.dump(state, file, ensure_ascii=False)
    os.replace(os.path.join(job, 'progress.json.part'), os.path.join(job, 'progress.json'))


def wait_for_reader():
    """As translate.py: Reader's transcription goes first (90 s since its last sign of life)."""
    while True:
        try:
            if time.time() - os.path.getmtime(BUSY) > 90:
                return
        except OSError:
            return
        time.sleep(5)


def stub_speak(lines, wav):
    """A 0.4 s tone per line, so tests need neither the model nor the speaker binary."""
    rate, cues, frames, at = 16000, [], bytearray(), 0
    for _ in lines:
        n = int(0.4 * rate)
        frames += b''.join(struct.pack('<h', int(8000 * math.sin(2 * math.pi * 440 * i / rate))) for i in range(n))
        cues.append((at / rate, (at + n) / rate))
        pause = int(0.35 * rate)
        frames += b'\0\0' * pause
        at += n + pause
    with wave.open(wav, 'wb') as out:
        out.setnchannels(1), out.setsampwidth(2), out.setframerate(rate), out.writeframes(bytes(frames))
    return cues


def speak(job, lines, wav):
    if os.environ.get('SPEAK_STUB') == '1':
        return stub_speak(lines, wav)
    child = subprocess.Popen([SPEAKER, VOICE, wav, '2'], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
    child.stdin.write('\n'.join(lines) + '\n')
    child.stdin.close()
    for line in child.stderr:
        if (match := re.match(r'line (\d+)/(\d+)', line)):
            progress(job, stage='speaking', title=TITLE, percent=100 * (int(match[1]) - 1) / int(match[2]))
    cues = [tuple(float(x) for x in line.split()) for line in child.stdout.read().splitlines() if line.strip()]
    if child.wait() != 0 or len(cues) != len(lines):
        raise RuntimeError('The phone could not speak the story.')
    return cues


def timestamp(seconds):
    ms = round(seconds * 1000)
    return f'{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}'


def main(job):
    global TITLE
    request = json.load(sys.stdin)
    TITLE = request['title']
    lines = [re.sub(r'\s+', ' ', line).strip() for line in request['lines'] if line.strip()]
    progress(job, stage='speaking', title=TITLE, percent=0)
    os.makedirs(os.path.dirname(MODEL_LOCK), exist_ok=True)
    with open(MODEL_LOCK, 'a') as lock:
        # Waiting for a translation or story to finish, saying so: an untouched progress file is
        # taken for a dead download after ten minutes.
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                progress(job, stage='waiting', title=TITLE)
                time.sleep(30)
        wait_for_reader()
        wav = os.path.join(job, 'speech.wav')
        cues = speak(job, lines, wav)
    progress(job, stage='packing', title=TITLE)
    # -nostdin: ffmpeg otherwise reads keyboard commands from stdin, which here may be anything.
    subprocess.run([FFMPEG, '-nostdin', '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, '-ac', '1',
                    '-ar', '24000', '-c:a', 'aac', '-b:a', '64k', os.path.join(job, 'media.m4a')], check=True)
    os.remove(wav)
    with open(os.path.join(job, 'media.zh.vtt'), 'w', encoding='utf-8') as vtt:
        vtt.write('WEBVTT\n\n')
        for (start, end), line in zip(cues, lines):
            vtt.write(f'{timestamp(start)} --> {timestamp(end)}\n{line}\n\n')
    with open(os.path.join(job, 'meta.json'), 'w', encoding='utf-8') as meta:
        json.dump({'title': TITLE, 'job': os.path.basename(job), 'kind': 'story'}, meta, ensure_ascii=False)
    part = os.path.join(os.path.dirname(job), os.path.basename(job) + '.tar.part')
    with tarfile.open(part, 'w') as tar:
        for name in ('media.m4a', 'media.zh.vtt', 'meta.json'):
            tar.add(os.path.join(job, name), arcname=name)
    os.replace(part, os.path.join(job, 'bundle.tar'))
    os.remove(os.path.join(job, 'progress.json'))
    # English, as a download gets it: in the background, when the model is free.
    if os.path.exists(TRANSLATE) and os.environ.get('SPEAK_STUB') != '1':
        with open(os.path.join(job, 'translate.log'), 'a') as log:
            subprocess.Popen([sys.executable, TRANSLATE, job], stdout=log, stderr=log, start_new_session=True)


TITLE = ''

if __name__ == '__main__':
    folder = sys.argv[1]
    try:
        main(folder)
    except Exception as error:  # the reader sees why under New from Termux, as for a failed download
        progress(folder, stage='failed', title=TITLE or 'A story', reason=str(error))
        raise
