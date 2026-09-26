#!/usr/bin/env python3
"""Transcribe a video in chunks, serving the transcript as it grows (ADR-0019).

    transcribe.py <job directory> <media file>

Writes <job>/media.zh.vtt after every chunk, and <job>/status.json as {"through": seconds, "done": bool}.
The reader service (reader-service.py) serves them from ~/downloads, so the app can poll both while
this runs.

The first chunk uses the base model so the first lines arrive in seconds; the rest use small, which
measured four times fewer errors. Each chunk's last line is dropped and redone as the start of the
next chunk, so no word is cut at a boundary.

No prompt. One was used to keep base in simplified characters, and with any prompt whisper.cpp
returns a chunk as its first sentence only: a street interview lost 11-38 s (13 lines) that way, and
a monologue came back as one 149-character line. Without it, measured on both videos, base and small
wrote no traditional characters. Long segments are still cut at clause punctuation (`lines`).
"""

import json
import os
import subprocess
import sys
import time

CHUNK_MS = 30_000  # Whisper's own window: shorter chunks cost the same and do less.
# Four, not every core: 16 threads beside other load measured 44 s against 6 s for 4, and phones pair
# four fast cores with slow ones that the rest would wait on.
THREADS = min(4, os.cpu_count() or 4)
MODELS = os.environ.get('WHISPER_MODELS', os.path.expanduser('~/.whisper'))
# Overridable so tests can use tiny: they check the plumbing, not the transcript.
FIRST_MODEL = os.environ.get('WHISPER_FIRST_MODEL', 'base')
MODEL = os.environ.get('WHISPER_MODEL', 'small')
WHISPER = os.environ.get('WHISPER', 'whisper-cli')
# Where a line ends: after clause punctuation, or at the next token once it is this long, for speech
# whisper did not punctuate. Subtitle lines on the videos measured run 10 to 25 characters.
# How long a chunk takes on this device, per model, for the bar Reader shows until its lines arrive:
# whisper-cli reports progress per 30 s window, so for one chunk only 100% at the end. Starts from
# the phone's measurements (2026-09-26) and then follows this device.
TIMINGS = os.path.join(MODELS, 'chunk-seconds.json')
EXPECTED = {'base': 20.0, 'small': 45.0}

BREAKS = '，,。？?！!；;'
LONGEST = 24


def lines(segments):
    """(from ms, to ms, text) per line, from whisper's full JSON segments with token timestamps."""
    found = []
    for segment in segments:
        text, start = '', None
        for token in segment['tokens']:
            if token['text'].startswith('[_'):  # [_BEG_], [_TT_...]: timing tokens, not text
                continue
            if start is None:
                start = token['offsets']['from']
            text += token['text']
            if text.rstrip()[-1:] in BREAKS or len(text.strip()) >= LONGEST:
                found.append((start, token['offsets']['to'], text.strip().rstrip('，,')))
                text, start = '', None
        if text.strip():
            found.append((start, segment['offsets']['to'], text.strip().rstrip('，,')))
    return [line for line in found if line[2]]


def stamp(ms):
    h, rest = divmod(ms, 3_600_000)
    m, rest = divmod(rest, 60_000)
    s, ms = divmod(rest, 1000)
    return f'{h:02}:{m:02}:{s:02}.{ms:03}'


def write_atomically(path, text):
    with open(path + '.part', 'w', encoding='utf-8') as file:
        file.write(text)
    os.replace(path + '.part', path)


def duration_ms(wav):
    return (os.path.getsize(wav) - 44) * 1000 // (16_000 * 2)


def expected_seconds():
    try:
        with open(TIMINGS, encoding='utf-8') as file:
            return {**EXPECTED, **json.load(file)}
    except (OSError, ValueError):
        return dict(EXPECTED)


def main(job, media):
    status = os.path.join(job, 'status.json')
    timings = expected_seconds()
    # Before the audio is extracted, so Reader can say something from the first second.
    write_atomically(status, json.dumps({'through': 0, 'done': False, 'total': None}))
    wav = os.path.join(job, 'audio.wav')
    subprocess.run(
        ['ffmpeg', '-loglevel', 'error', '-y', '-i', media, '-ar', '16000', '-ac', '1', wav],
        check=True,
    )
    total = duration_ms(wav)
    cues, offset, first = [], 0, True

    while offset < total:
        model = FIRST_MODEL if first else MODEL
        out = os.path.join(job, 'chunk')
        started = time.time()
        write_atomically(status, json.dumps({
            'through': offset / 1000, 'done': False, 'total': total / 1000,
            'chunk': {'started': started, 'expected': timings.get(model, 30.0)},
        }))
        subprocess.run(
            [WHISPER, '-m', os.path.join(MODELS, f'ggml-{model}.bin'), '-f', wav, '-l', 'zh',
             '-t', str(THREADS), '--offset-t', str(offset),
             '--duration', str(CHUNK_MS), '-ojf', '-of', out],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        # Half the last measurement, half the one before: a single slow chunk moves the estimate
        # without taking it over.
        timings[model] = round((timings.get(model, 30.0) + time.time() - started) / 2, 1)
        write_atomically(TIMINGS, json.dumps(timings))
        with open(out + '.json', encoding='utf-8') as file:
            segments = lines(json.load(file)['transcription'])
        last_chunk = offset + CHUNK_MS >= total
        if len(segments) > 1 and not last_chunk:
            offset = segments[-1][0]
            segments = segments[:-1]
        else:
            offset += CHUNK_MS
        cues.extend(segments)
        first = False

        write_atomically(
            os.path.join(job, 'media.zh.vtt'),
            'WEBVTT\n\n' + ''.join(f'{stamp(a)} --> {stamp(b)}\n{t}\n\n' for a, b, t in cues),
        )
        write_atomically(status, json.dumps({'through': min(offset, total) / 1000, 'done': False,
                                             'total': total / 1000}))
        print(f'transcribed through {min(offset, total) / 1000:.0f} s of {total / 1000:.0f} s', flush=True)

    os.remove(wav)
    write_atomically(status, json.dumps({'through': total / 1000, 'done': True, 'total': total / 1000}))
    print('transcript complete', flush=True)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
