#!/usr/bin/env python3
"""Transcribe a video in chunks, serving the transcript as it grows (ADR-0019).

    transcribe.py <job directory> <media file>

Writes <job>/media.zh.vtt after every chunk, and <job>/status.json as {"through": seconds, "done": bool}.
Serves the parent directory on 127.0.0.1:8765 so the app can poll both while this runs; if the port
is taken, an earlier run is already serving the same directory, and this one only transcribes.

The first chunk uses the base model so the first lines arrive in seconds; the rest use small, which
measured four times fewer errors. Each chunk's last line is dropped and redone as the start of the
next chunk, so no word is cut at a boundary.
"""

import http.server
import json
import os
import subprocess
import sys
import threading
import time

PORT = 8765
CHUNK_MS = 30_000  # Whisper's own window: shorter chunks cost the same and do less.
PROMPT = '以下是普通话的句子。'  # Without it, base drifts into traditional characters.
# Four, not every core: 16 threads beside other load measured 44 s against 6 s for 4, and phones pair
# four fast cores with slow ones that the rest would wait on.
THREADS = min(4, os.cpu_count() or 4)
MODELS = os.environ.get('WHISPER_MODELS', os.path.expanduser('~/.whisper'))
# Overridable so tests can use tiny: they check the plumbing, not the transcript.
FIRST_MODEL = os.environ.get('WHISPER_FIRST_MODEL', 'base')
MODEL = os.environ.get('WHISPER_MODEL', 'small')
WHISPER = os.environ.get('WHISPER', 'whisper-cli')


class Handler(http.server.SimpleHTTPRequestHandler):
    """Static files, readable from the app's origin, and never cached."""

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET')
        self.end_headers()

    def log_message(self, *args):
        pass


def serve(root):
    """True when this run owns the server."""
    try:
        server = http.server.ThreadingHTTPServer(
            ('127.0.0.1', PORT), lambda *a: Handler(*a, directory=root)
        )
    except OSError:
        return False
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return True


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


def main(job, media):
    wav = os.path.join(job, 'audio.wav')
    subprocess.run(
        ['ffmpeg', '-loglevel', 'error', '-y', '-i', media, '-ar', '16000', '-ac', '1', wav],
        check=True,
    )
    serving = serve(os.path.dirname(os.path.abspath(job)))
    total = duration_ms(wav)
    cues, offset, first = [], 0, True
    status = os.path.join(job, 'status.json')
    write_atomically(status, json.dumps({'through': 0, 'done': False}))

    while offset < total:
        model = FIRST_MODEL if first else MODEL
        prompt = PROMPT + (cues[-1][2] if cues else '')
        out = os.path.join(job, 'chunk')
        subprocess.run(
            [WHISPER, '-m', os.path.join(MODELS, f'ggml-{model}.bin'), '-f', wav, '-l', 'zh',
             '-t', str(THREADS), '--prompt', prompt, '--offset-t', str(offset),
             '--duration', str(CHUNK_MS), '-oj', '-of', out],
            check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        with open(out + '.json', encoding='utf-8') as file:
            segments = [
                (s['offsets']['from'], s['offsets']['to'], s['text'].strip())
                for s in json.load(file)['transcription']
                if s['text'].strip()
            ]
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
        write_atomically(status, json.dumps({'through': min(offset, total) / 1000, 'done': False}))
        print(f'transcribed through {min(offset, total) / 1000:.0f} s of {total / 1000:.0f} s', flush=True)

    os.remove(wav)
    write_atomically(status, json.dumps({'through': total / 1000, 'done': True}))
    print('transcript complete', flush=True)
    if serving:
        # The app fetches the final transcript on its next poll; give it time to, even if it was
        # in the background when the last chunk landed.
        time.sleep(15 * 60)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
